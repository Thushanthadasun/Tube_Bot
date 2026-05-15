import { useState } from "react";
import { Header } from "@/components/header";
import { VideoGrid } from "@/components/video-grid";
import { ChatPanel } from "@/components/chat-panel";
import { useGetYoutubeHomepage, useGetYoutubePreferences, useSearchYoutube } from "@workspace/api-client-react";
import { getGetYoutubeHomepageQueryKey } from "@workspace/api-client-react";

export default function Home() {
  const [searchQuery, setSearchQuery] = useState<string | undefined>();
  
  const { data: preferences } = useGetYoutubePreferences();
  
  // Load homepage unless we are explicitly searching
  const { 
    data: homepageVideos, 
    isLoading: isLoadingHome, 
    error: homeError 
  } = useGetYoutubeHomepage(undefined, { 
    query: { 
      enabled: !searchQuery,
      queryKey: getGetYoutubeHomepageQueryKey()
    } 
  });

  // Load search results if we have a query
  const {
    data: searchVideos,
    isLoading: isLoadingSearch,
    error: searchError
  } = useSearchYoutube({ q: searchQuery || "" }, {
    query: {
      enabled: !!searchQuery,
      queryKey: ["/api/youtube/search", { q: searchQuery }] as const
    }
  });

  const handleSearch = (query: string) => {
    setSearchQuery(query);
  };

  const currentVideos = searchQuery ? searchVideos : homepageVideos;
  const isLoading = searchQuery ? isLoadingSearch : isLoadingHome;
  const currentError = searchQuery ? searchError : homeError;

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-background">
      <Header preferences={preferences} onSearch={handleSearch} />
      
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-y-auto custom-scrollbar">
          {searchQuery && (
            <div className="px-6 pt-6 pb-2">
              <h2 className="text-xl font-bold flex items-center gap-2">
                Search results for "{searchQuery}"
                <button 
                  onClick={() => setSearchQuery(undefined)}
                  className="text-sm font-normal text-muted-foreground hover:text-foreground transition-colors ml-4"
                >
                  Clear search
                </button>
              </h2>
            </div>
          )}
          <VideoGrid videos={currentVideos} isLoading={isLoading} error={currentError as Error} />
        </main>
        
        <aside className="w-full max-w-sm shrink-0 shadow-[-4px_0_24px_-10px_rgba(0,0,0,0.5)] z-10 hidden md:block">
          <ChatPanel onSearchRequest={handleSearch} />
        </aside>
      </div>
    </div>
  );
}