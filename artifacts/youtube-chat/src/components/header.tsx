import { YoutubePreferences, useUpdateYoutubePreferences } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, Search, PlaySquare } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetYoutubePreferencesQueryKey, getGetYoutubeHomepageQueryKey } from "@workspace/api-client-react";

interface HeaderProps {
  preferences?: YoutubePreferences;
  onSearch?: (query: string) => void;
}

export function Header({ preferences, onSearch }: HeaderProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const updatePreferences = useUpdateYoutubePreferences();
  const queryClient = useQueryClient();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim() && onSearch) {
      onSearch(searchQuery);
    }
  };

  const removeBlockedCategory = (categoryToRemove: string) => {
    if (!preferences) return;
    
    const newCategories = preferences.blockedCategories.filter(c => c !== categoryToRemove);
    updatePreferences.mutate(
      { data: { blockedCategories: newCategories } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetYoutubePreferencesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetYoutubeHomepageQueryKey() });
        }
      }
    );
  };

  return (
    <header className="sticky top-0 z-40 w-full bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border">
      <div className="flex h-16 items-center justify-between px-4 gap-4">
        <div className="flex items-center gap-2 font-semibold text-lg shrink-0">
          <div className="w-8 h-8 bg-destructive rounded flex items-center justify-center text-white">
            <PlaySquare className="w-5 h-5 fill-current" />
          </div>
          <span className="hidden sm:inline-block tracking-tight">TubeChat AI</span>
        </div>

        <form onSubmit={handleSearch} className="flex-1 max-w-2xl px-4 flex items-center">
          <div className="relative w-full flex items-center group">
            <div className="absolute left-3 text-muted-foreground group-focus-within:text-primary transition-colors">
              <Search className="w-4 h-4" />
            </div>
            <Input 
              type="search" 
              placeholder="Search videos..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 h-10 rounded-full bg-card/50 border-border focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:bg-card"
            />
          </div>
        </form>

        <div className="flex items-center shrink-0">
          {/* Avatar placeholder */}
          <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-medium text-sm">
            U
          </div>
        </div>
      </div>
      
      {preferences && (preferences.blockedCategories?.length > 0 || preferences.blockedKeywords?.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-card/30 border-t border-border text-sm">
          <span className="text-muted-foreground text-xs font-medium uppercase tracking-wider">Filtered:</span>
          {preferences.blockedCategories?.map(category => (
            <Badge key={category} variant="secondary" className="gap-1 pl-2 pr-1 hover:bg-secondary/80">
              {category}
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-4 w-4 rounded-full hover:bg-background"
                onClick={() => removeBlockedCategory(category)}
              >
                <X className="w-3 h-3" />
              </Button>
            </Badge>
          ))}
          {preferences.blockedKeywords?.map(keyword => (
            <Badge key={`kw-${keyword}`} variant="outline" className="gap-1 text-muted-foreground">
              "{keyword}"
            </Badge>
          ))}
        </div>
      )}
    </header>
  );
}