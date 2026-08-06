// ============================================================
// MoniStream — Token Refresh API Route
// ============================================================

import { NextRequest } from 'next/server';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import { verifyRefreshToken, signAccessToken, ApiError, getAuthCookieOptions } from '@/lib/auth';

// Helper to build a response that clears both auth cookies
function buildClearCookiesResponse(message: string, status: number) {
  const isProduction = process.env.NODE_ENV === 'production';
  const cookieDomain = process.env.COOKIE_DOMAIN || undefined;
  const domainAttr = cookieDomain ? `; Domain=${cookieDomain}` : '';
  const secureAttr = isProduction ? '; Secure' : '';

  const headers = new Headers();
  headers.append(
    'Set-Cookie',
    `access_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secureAttr}${domainAttr}`
  );
  headers.append(
    'Set-Cookie',
    `refresh_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secureAttr}${domainAttr}`
  );

  return new Response(
    JSON.stringify({ success: false, error: message }),
    { status, headers }
  );
}

export async function POST(req: NextRequest) {
  try {
    const refreshToken = req.cookies.get('refresh_token')?.value;

    if (!refreshToken) {
      return buildClearCookiesResponse('Refresh token not found', 401);
    }

    // Verify refresh token — catch JWT errors explicitly
    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch (err: any) {
      const message =
        err.name === 'TokenExpiredError'
          ? 'Refresh token expired'
          : 'Invalid refresh token';
      return buildClearCookiesResponse(message, 401);
    }

    await connectDB();

    // Check if refresh token exists in DB (not revoked)
    const user = await User.findOne({
      _id: payload.userId,
      'refreshTokens.token': refreshToken,
    });

    if (!user) {
      return buildClearCookiesResponse('Refresh token revoked', 401);
    }

    // Generate new access token
    const accessToken = signAccessToken({
      userId: user._id.toString(),
      email: user.email,
    });

    // Build response with new access token cookie
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    const accessCookie = getAuthCookieOptions(false);

    headers.append(
      'Set-Cookie',
      `access_token=${accessToken}; HttpOnly; Path=${accessCookie.path}; Max-Age=${accessCookie.maxAge}; SameSite=${accessCookie.sameSite}${accessCookie.secure ? '; Secure' : ''}`
    );

    return new Response(
      JSON.stringify({ success: true, data: { accessToken } }),
      { status: 200, headers }
    );
  } catch (error) {
    console.error('Token refresh error:', error);
    return buildClearCookiesResponse('Token refresh failed', 500);
  }
}
