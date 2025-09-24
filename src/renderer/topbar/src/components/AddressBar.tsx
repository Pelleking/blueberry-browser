import React, { useState, useEffect } from "react";
import { ArrowLeft, ArrowRight, RefreshCw, Loader2, PanelLeftClose, PanelLeft } from "lucide-react";
import { QrCode } from "lucide-react";
import { Cpu } from "lucide-react";
import { useBrowser } from "../contexts/BrowserContext";
import { ToolBarButton } from "../components/ToolBarButton";
import { Favicon } from "../components/Favicon";
import { DarkModeToggle } from "../components/DarkModeToggle";
import { cn } from "@common/lib/utils";

export const AddressBar: React.FC = () => {
    const { activeTab, navigateToUrl, goBack, goForward, reload, isLoading } = useBrowser();
    const [url, setUrl] = useState("");
    const [isEditing, setIsEditing] = useState(false);
    const [isFocused, setIsFocused] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [offline, setOffline] = useState(false);
    const [offlineBlinkError, setOfflineBlinkError] = useState(false);
    const [bridgeConnected, setBridgeConnected] = useState(false);

    // Update URL when active tab changes
    useEffect(() => {
        if (activeTab && !isEditing) {
            setUrl(activeTab.url || "");
        }
    }, [activeTab, isEditing]);

    // Load initial offline mode
    useEffect(() => {
        let mounted = true;
        if (window.topBarAPI?.getOfflineMode) {
            window.topBarAPI
                .getOfflineMode()
                .then((v) => {
                    if (mounted) setOffline(!!v);
                })
                .catch(() => {});
        }
        // Listen for offline mode updates (e.g., auto-switch when network is lost)
        if (window.topBarAPI?.onOfflineModeUpdated) {
            window.topBarAPI.onOfflineModeUpdated((enabled) => {
                if (mounted) setOffline(!!enabled);
            });
        }
        return () => {
            mounted = false;
        };
    }, []);

    // Listen for bridge connection status
    useEffect(() => {
        if (!window.topBarAPI?.onBridgeConnected) return;
        window.topBarAPI.onBridgeConnected((connected) => setBridgeConnected(!!connected));
        return () => window.topBarAPI?.removeBridgeConnectedListener?.();
    }, []);

    const handleSubmit = (e: React.FormEvent): void => {
        e.preventDefault();
        if (!url.trim()) return;

        let finalUrl = url.trim();

        // Add protocol if missing
        if (!finalUrl.startsWith("http://") && !finalUrl.startsWith("https://")) {
            // Check if it looks like a domain
            if (finalUrl.includes(".") && !finalUrl.includes(" ")) {
                finalUrl = `https://${finalUrl}`;
            } else {
                // Treat as search query
                finalUrl = `https://www.google.com/search?q=${encodeURIComponent(finalUrl)}`;
            }
        }

        navigateToUrl(finalUrl);
        setIsEditing(false);
        setIsFocused(false);
        (document.activeElement as HTMLElement)?.blur();
    };

    const handleFocus = (): void => {
        setIsEditing(true);
        setIsFocused(true);
    };

    const handleBlur = (): void => {
        setIsEditing(false);
        setIsFocused(false);
        // Reset to current tab URL if editing was cancelled
        if (activeTab) {
            setUrl(activeTab.url || "");
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent): void => {
        if (e.key === "Escape") {
            setIsEditing(false);
            setIsFocused(false);
            if (activeTab) {
                setUrl(activeTab.url || "");
            }
            (e.target as HTMLInputElement).blur();
        }
    };

    const canGoBack = activeTab !== null;
    const canGoForward = activeTab !== null;

    // Extract domain and title for display
    const getDomain = (): string => {
        if (!activeTab?.url) return "";
        try {
            const urlObj = new URL(activeTab.url);
            return urlObj.hostname.replace("www.", "");
        } catch {
            return activeTab.url;
        }
    };

    const getPath = (): string => {
        if (!activeTab?.url) return "";
        try {
            const urlObj = new URL(activeTab.url);
            return urlObj.pathname + urlObj.search + urlObj.hash;
        } catch {
            return "";
        }
    };

    const getFavicon = (): string | null => {
        if (!activeTab?.url) return null;
        try {
            const domain = new URL(activeTab.url).hostname;
            return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
        } catch {
            return null;
        }
    };

    const toggleSidebar = (): void => {
        setIsSidebarOpen(!isSidebarOpen);
        // Send IPC event to toggle sidebar
        if (window.topBarAPI) {
            window.topBarAPI.toggleSidebar();
        }
    };

    const toggleOffline = async (): Promise<void> => {
        if (!window.topBarAPI?.setOfflineMode) return;
        const next = !offline;
        const confirmed = await window.topBarAPI.setOfflineMode(next);
        setOffline(!!confirmed);
        if (next && !confirmed) {
            // Blink the icon red briefly
            setOfflineBlinkError(true);
            setTimeout(() => setOfflineBlinkError(false), 1200);
        }
    };

    const generateBridgeQR = async (): Promise<void> => {
        try {
            await window.topBarAPI?.generateBridgeQR?.();
        } catch {}
    };

    return (
        <>
            {/* Navigation Controls */}
            <div className="flex gap-1.5 app-region-no-drag">
                <ToolBarButton
                    Icon={ArrowLeft}
                    onClick={goBack}
                    active={canGoBack && !isLoading}
                />
                <ToolBarButton
                    Icon={ArrowRight}
                    onClick={goForward}
                    active={canGoForward && !isLoading}
                />
                <ToolBarButton
                    onClick={reload}
                    active={activeTab !== null && !isLoading}
                >
                    {isLoading ? (
                        <Loader2 className="size-4.5 animate-spin" />
                    ) : (
                        <RefreshCw className="size-4.5" />
                    )}
                </ToolBarButton>
            </div>

            {/* Address Bar */}
            {isFocused ? (
                // Expanded State
                <form onSubmit={handleSubmit} className="flex-1 min-w-0 max-w-full">
                    <div className="bg-background rounded-lg shadow-md p-1 dark:bg-secondary">
                        <input
                            type="text"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            onFocus={handleFocus}
                            onBlur={handleBlur}
                            onKeyDown={handleKeyDown}
                            className="w-full px-1 py-0.5 text-xs outline-none bg-transparent text-foreground truncate"
                            placeholder={activeTab ? "Enter URL or search term" : "No active tab"}
                            disabled={!activeTab}
                            spellCheck={false}
                            autoFocus
                        />
                    </div>
                </form>
            ) : (
                // Collapsed State
                <div
                    onClick={handleFocus}
                    className={cn(
                        "flex-1 px-3 h-8 rounded-md cursor-text group/address-bar",
                        "hover:bg-muted text-muted-foreground app-region-no-drag",
                        "transition-colors duration-200",
                        "dark:hover:bg-muted/50"
                    )}
                >
                    <div className="flex h-full items-center">
                        {/* Favicon */}
                        <div className="size-4 mr-2">
                            <Favicon src={getFavicon()} />
                        </div>

                        {/* URL Display */}
                        <div className="text-[0.8rem] leading-normal truncate flex-1">
                            {activeTab ? (
                                <>
                                    <span className="text-foreground dark:text-foreground">{getDomain()}</span>
                                    <span className="group-hover/address-bar:hidden text-muted-foreground/60">
                                        {activeTab.title && ` / ${activeTab.title}`}
                                    </span>
                                    <span className="group-hover/address-bar:inline hidden text-muted-foreground/60">
                                        {getPath()}
                                    </span>
                                </>
                            ) : (
                                <span className="text-muted-foreground">No active tab</span>
                            )}
                        </div>

                    </div>
                </div>
            )}

            {/* Actions Menu */}
            <div className="flex items-center gap-1 app-region-no-drag">
                <DarkModeToggle />
                <ToolBarButton
                    Icon={QrCode}
                    onClick={generateBridgeQR}
                    className={bridgeConnected ? "text-green-500" : undefined}
                />
                <ToolBarButton
                    Icon={Cpu}
                    onClick={toggleOffline}
                    toggled={offline}
                    className={offlineBlinkError ? "text-red-500" : (offline ? "text-green-500" : undefined)}
                />
                <ToolBarButton
                    Icon={isSidebarOpen ? PanelLeftClose : PanelLeft}
                    onClick={toggleSidebar}
                    toggled={isSidebarOpen}
                />
            </div>
        </>
    );
};