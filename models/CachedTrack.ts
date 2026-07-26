import mongoose from 'mongoose';

const CachedTrackSchema = new mongoose.Schema(
  {
    videoId: { type: String, required: true, unique: true }, // Links it to existing track / YouTube ID
    title: { type: String, required: true },
    artist: { type: String, required: true },
    albumName: { type: String },
    thumbnails: {
      default: {
        url: { type: String },
        width: { type: Number },
        height: { type: Number },
      },
      high: {
        url: { type: String },
        width: { type: Number },
        height: { type: Number },
      },
    },
    duration: { type: Number },
    durationText: { type: String },
    genre: { type: String },
    tags: [{ type: String }],
    audioUrl: { type: String }, // Direct playable MP3 URL (Firebase)
    audioFormat: { type: String, default: 'mp3' },
    audioBitrate: { type: Number },
    audioSize: { type: Number },
    source: { type: String, default: 'pagalworld_cached' },
    pagalworldSlug: { type: String },
    channelId: { type: String, default: 'pagalworld' },
    channelTitle: { type: String, default: 'PagalWorld' },
    playCount: { type: Number, default: 0 },
    cachedBy: { type: String }, // User who triggered cache
    status: {
      type: String,
      enum: ['pending', 'processing', 'ready', 'failed', 'admin_request', 'speculative'],
      default: 'pending',
    },
    cachedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Create indexes for efficient searching
CachedTrackSchema.index({ title: 'text', artist: 'text', albumName: 'text' });
CachedTrackSchema.index({ videoId: 1 });
CachedTrackSchema.index({ status: 1 });

const CachedTrack =
  mongoose.models.CachedTrack || mongoose.model('CachedTrack', CachedTrackSchema);

export default CachedTrack;
