import { useState, useCallback, useRef } from "react";
import { YoutubeVideo } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetYoutubeHomepageQueryKey, getGetYoutubePreferencesQueryKey } from "@workspace/api-client-react";

export type MessageType = "chat" | "search_results" | "preference_update";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  videos?: YoutubeVideo[];
  type?: MessageType;
}

export function useChatStream() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<number | undefined>();
  const queryClient = useQueryClient();
  const abortControllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (content: string, type: MessageType = "chat") => {
    if (!content.trim()) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content,
      type
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    const assistantMessageId = (Date.now() + 1).toString();
    setMessages(prev => [
      ...prev,
      { id: assistantMessageId, role: "assistant", content: "", type: "chat" }
    ]);

    try {
      const response = await fetch('/api/youtube/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: content, conversationId }),
        signal: abortControllerRef.current.signal
      });

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let assistantContent = "";
      let videosResult: YoutubeVideo[] | undefined;
      let finalType: MessageType = "chat";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.type === 'text' && data.content) {
                assistantContent += data.content;
                setMessages(prev => prev.map(msg => 
                  msg.id === assistantMessageId 
                    ? { ...msg, content: assistantContent }
                    : msg
                ));
              }

              if (data.type === 'videos' && data.videos) {
                videosResult = data.videos;
                finalType = "search_results";
                setMessages(prev => prev.map(msg => 
                  msg.id === assistantMessageId 
                    ? { ...msg, videos: videosResult, type: finalType }
                    : msg
                ));
              }

              if (data.type === 'preference_update') {
                finalType = "preference_update";
                queryClient.invalidateQueries({ queryKey: getGetYoutubePreferencesQueryKey() });
                queryClient.invalidateQueries({ queryKey: getGetYoutubeHomepageQueryKey() });
                setMessages(prev => prev.map(msg => 
                  msg.id === assistantMessageId 
                    ? { ...msg, type: finalType }
                    : msg
                ));
              }

              if (data.done) {
                setIsLoading(false);
              }
            } catch (e) {
              // ignore parse errors for incomplete chunks
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Stream aborted');
      } else {
        console.error('Chat error:', error);
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessageId 
            ? { ...msg, content: msg.content || "Sorry, I encountered an error." }
            : msg
        ));
      }
      setIsLoading(false);
    }
  }, [conversationId, queryClient]);

  const clearChat = useCallback(() => {
    setMessages([]);
    setConversationId(undefined);
  }, []);

  return {
    messages,
    isLoading,
    sendMessage,
    clearChat
  };
}