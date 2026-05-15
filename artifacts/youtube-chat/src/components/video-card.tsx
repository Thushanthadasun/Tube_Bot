import { YoutubeVideo } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";

interface VideoCardProps {
  video: YoutubeVideo;
}

export function VideoCard({ video }: VideoCardProps) {
  const formatViews = (views?: string) => {
    if (!views) return "";
    const num = parseInt(views, 10);
    if (isNaN(num)) return views;
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M views`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K views`;
    return `${num} views`;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "1 day ago";
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
  };

  const parseDuration = (duration?: string) => {
    if (!duration) return "";
    const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
    if (!match) return "";
    
    const hours = (match[1] || "").replace("H", "");
    const minutes = (match[2] || "").replace("M", "");
    const seconds = (match[3] || "").replace("S", "");
    
    let result = "";
    if (hours) result += `${hours}:`;
    if (minutes) {
      result += `${hours ? minutes.padStart(2, "0") : minutes}:`;
    } else {
      result += "0:";
    }
    result += seconds ? seconds.padStart(2, "0") : "00";
    return result;
  };

  return (
    <a 
      href={`https://youtube.com/watch?v=${video.videoId}`} 
      target="_blank" 
      rel="noopener noreferrer"
      className="flex flex-col gap-3 group"
      data-testid={`link-video-${video.videoId}`}
    >
      <div className="relative aspect-video rounded-xl overflow-hidden bg-card-border/50">
        <img 
          src={video.thumbnailUrl} 
          alt={video.title} 
          className="object-cover w-full h-full transition-transform duration-200 group-hover:scale-105"
        />
        {video.duration && (
          <div className="absolute bottom-1.5 right-1.5 bg-black/80 px-1.5 py-0.5 rounded text-xs font-medium text-white">
            {parseDuration(video.duration)}
          </div>
        )}
      </div>
      <div className="flex gap-3">
        <div className="w-9 h-9 rounded-full bg-card-border/80 flex-shrink-0 flex items-center justify-center overflow-hidden">
          <span className="text-sm font-bold text-muted-foreground">
            {video.channelTitle.charAt(0).toUpperCase()}
          </span>
        </div>
        <div className="flex flex-col">
          <h3 className="text-sm font-medium line-clamp-2 leading-tight group-hover:text-primary/90 transition-colors">
            {video.title}
          </h3>
          <div className="text-xs text-muted-foreground mt-1 flex flex-col gap-0.5">
            <span className="hover:text-foreground transition-colors">{video.channelTitle}</span>
            <div className="flex items-center gap-1.5">
              {video.viewCount && <span>{formatViews(video.viewCount)}</span>}
              {video.viewCount && video.publishedAt && <span className="text-[10px]">•</span>}
              {video.publishedAt && <span>{formatDate(video.publishedAt)}</span>}
            </div>
          </div>
        </div>
      </div>
    </a>
  );
}

export function VideoCardSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="aspect-video w-full rounded-xl" />
      <div className="flex gap-3">
        <Skeleton className="w-9 h-9 rounded-full flex-shrink-0" />
        <div className="flex flex-col gap-2 w-full">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2 mt-1" />
        </div>
      </div>
    </div>
  );
}