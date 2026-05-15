import { YoutubeVideo } from "@workspace/api-client-react";
import { VideoCard, VideoCardSkeleton } from "./video-card";
import { AlertCircle } from "lucide-react";

interface VideoGridProps {
  videos: YoutubeVideo[] | undefined;
  isLoading: boolean;
  error: Error | null;
}

export function VideoGrid({ videos, isLoading, error }: VideoGridProps) {
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center space-y-4">
        <AlertCircle className="w-12 h-12 text-destructive" />
        <h2 className="text-xl font-semibold text-foreground">Something went wrong</h2>
        <p className="max-w-md">We couldn't load the videos right now. The API key might be missing or invalid.</p>
        <p className="text-sm border border-border p-4 rounded-lg bg-card/50">
          Try chatting with the AI instead. The AI can still help you search for videos or update your preferences.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-x-4 gap-y-8 p-6">
        {Array.from({ length: 10 }).map((_, i) => (
          <VideoCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (!videos || videos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center">
        <h2 className="text-xl font-semibold text-foreground mb-2">No videos found</h2>
        <p>Try searching for something else or ask the AI to recommend some content.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-x-4 gap-y-8 p-6">
      {videos.map((video) => (
        <VideoCard key={video.videoId} video={video} />
      ))}
    </div>
  );
}