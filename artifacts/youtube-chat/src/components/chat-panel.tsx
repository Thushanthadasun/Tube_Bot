import { useEffect, useRef, useState } from "react";
import { useChatStream, ChatMessage } from "@/hooks/use-chat";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SendHorizontal, Bot, User, Sparkles } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { YoutubeVideo } from "@workspace/api-client-react";
import { VideoCard } from "./video-card";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ChatPanelProps {
  onSearchRequest?: (query: string) => void;
}

export function ChatPanel({ onSearchRequest }: ChatPanelProps) {
  const { messages, isLoading, sendMessage } = useChatStream();
  const [inputValue, setInputValue] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isLoading) return;
    sendMessage(inputValue);
    setInputValue("");
  };

  return (
    <div className="flex flex-col h-full bg-card/30 border-l border-border relative">
      <div className="p-4 border-b border-border flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-primary" />
        <h2 className="font-medium">AI Assistant</h2>
      </div>

      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[50vh] text-center space-y-4 text-muted-foreground p-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <Bot className="w-6 h-6" />
            </div>
            <p className="text-sm">
              I can help you find videos, filter content, and manage your YouTube homepage.
            </p>
            <div className="flex flex-col gap-2 w-full max-w-[200px] mt-4">
              <Button variant="outline" size="sm" onClick={() => sendMessage("Show me coding tutorials")} className="justify-start text-xs">
                "Show me coding tutorials"
              </Button>
              <Button variant="outline" size="sm" onClick={() => sendMessage("Block gaming videos")} className="justify-start text-xs">
                "Block gaming videos"
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "flex gap-3 max-w-[85%]",
                  msg.role === "user" ? "self-end flex-row-reverse" : "self-start"
                )}
              >
                <div className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5",
                  msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-card border border-border"
                )}>
                  {msg.role === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4 text-primary" />}
                </div>
                <div className="flex flex-col gap-2">
                  {msg.content && (
                    <div className={cn(
                      "p-3 rounded-2xl text-sm leading-relaxed",
                      msg.role === "user" 
                        ? "bg-primary text-primary-foreground rounded-tr-sm" 
                        : "bg-card border border-border rounded-tl-sm text-card-foreground"
                    )}>
                      {msg.content}
                    </div>
                  )}
                  
                  {msg.videos && msg.videos.length > 0 && (
                    <div className="flex flex-col gap-3 mt-2 bg-card p-3 rounded-xl border border-border w-full min-w-[280px]">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Results</span>
                      <div className="flex flex-col gap-3">
                        {msg.videos.slice(0, 3).map(video => (
                          <div key={video.videoId} className="flex gap-2">
                            <div className="w-24 h-16 rounded overflow-hidden flex-shrink-0 relative">
                              <img src={video.thumbnailUrl} className="object-cover w-full h-full" alt="" />
                            </div>
                            <div className="flex flex-col justify-center">
                              <h4 className="text-xs font-medium line-clamp-2">{video.title}</h4>
                              <span className="text-[10px] text-muted-foreground mt-0.5">{video.channelTitle}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {msg.type === "preference_update" && (
                    <div className="text-xs text-muted-foreground italic flex items-center gap-1.5 mt-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                      Preferences updated
                    </div>
                  )}
                </div>
              </div>
            ))}
            
            {isLoading && (
              <div className="flex gap-3 self-start max-w-[85%]">
                <div className="w-8 h-8 rounded-full bg-card border border-border flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Bot className="w-4 h-4 text-primary" />
                </div>
                <div className="p-4 rounded-2xl rounded-tl-sm bg-card border border-border flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" />
                  <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:0.2s]" />
                  <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:0.4s]" />
                </div>
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      <div className="p-4 border-t border-border bg-background">
        <form onSubmit={handleSubmit} className="relative flex items-center">
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Ask AI to find videos or block content..."
            className="pr-12 bg-card border-border h-12 rounded-full focus-visible:ring-1 focus-visible:ring-primary/50"
            disabled={isLoading}
          />
          <Button 
            type="submit" 
            size="icon" 
            variant="ghost" 
            className="absolute right-1.5 h-9 w-9 rounded-full text-primary hover:bg-primary/10 hover:text-primary"
            disabled={!inputValue.trim() || isLoading}
          >
            <SendHorizontal className="w-5 h-5" />
          </Button>
        </form>
      </div>
    </div>
  );
}