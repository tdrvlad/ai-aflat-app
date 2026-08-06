import { useState, useEffect } from 'react';
import { useRecoilValue } from 'recoil';
import { Outlet } from 'react-router-dom';
import { useMediaQuery } from '@librechat/client';
import {
  PromptGroupsProvider,
  AssistantsMapContext,
  AgentsMapContext,
  SetConvoProvider,
  FileMapContext,
} from '~/Providers';
import {
  useSearchEnabled,
  useAssistantsMap,
  useAuthContext,
  useAgentsMap,
  useFileMap,
} from '~/hooks';
import KeyboardShortcutsDialog from '~/components/Nav/KeyboardShortcutsDialog';
import KeyboardDeleteDialog from '~/components/Nav/KeyboardDeleteDialog';
import { useUserTermsQuery, useGetStartupConfig } from '~/data-provider';
import useKeyboardShortcuts from '~/hooks/useKeyboardShortcuts';
import { UnifiedSidebar } from '~/components/UnifiedSidebar';
import useDevAutoLogin from '~/components/Aflat/useDevAutoLogin';
import ConsentModal from '~/components/Aflat/ConsentModal';
import AnonShell from '~/components/Aflat/AnonShell';
import { TermsAndConditionsModal } from '~/components/ui';
import { useHealthCheck } from '~/data-provider';
import { Banner } from '~/components/Banners';
import store from '~/store';

/** Isolates keyboard shortcut listeners so they only mount after auth. */
function KeyboardShortcutsProvider() {
  useKeyboardShortcuts();
  return (
    <>
      <KeyboardShortcutsDialog />
      <KeyboardDeleteDialog />
    </>
  );
}

export default function Root() {
  const [showTerms, setShowTerms] = useState(false);
  const [bannerHeight, setBannerHeight] = useState(0);
  const sidebarExpanded = useRecoilValue(store.sidebarExpanded);
  const isSmallScreen = useMediaQuery('(max-width: 768px)');

  const { isAuthenticated, logout } = useAuthContext();

  /* LOCAL DEVELOPMENT ONLY — no-op unless the server says the door is open. */
  useDevAutoLogin();

  useHealthCheck(isAuthenticated);

  const assistantsMap = useAssistantsMap({ isAuthenticated });
  const agentsMap = useAgentsMap({ isAuthenticated });
  const fileMap = useFileMap({ isAuthenticated });

  const { data: config } = useGetStartupConfig();
  const { data: termsData } = useUserTermsQuery({
    enabled: isAuthenticated && config?.interface?.termsOfService?.modalAcceptance === true,
  });

  useSearchEnabled(isAuthenticated);

  useEffect(() => {
    if (termsData) {
      setShowTerms(!termsData.termsAccepted);
    }
  }, [termsData]);

  const handleAcceptTerms = () => {
    setShowTerms(false);
  };

  const handleDeclineTerms = () => {
    setShowTerms(false);
    logout('/login?redirect=false');
  };

  /**
   * ai-aflat: an anonymous visitor gets the chat screen, not a bounce.
   *
   * Upstream returns `null` here and lets the redirect hooks take the visitor
   * elsewhere; this fork has one chat screen, and being signed out is a state of
   * that screen rather than a different destination. The shell is deliberately
   * leaner than the authenticated one — the providers and sidebar below issue
   * authenticated queries that are not gated on auth state, so mounting them
   * without a session would 401 on every load.
   */
  if (!isAuthenticated) {
    return (
      <AnonShell>
        <Outlet />
      </AnonShell>
    );
  }

  return (
    <SetConvoProvider>
      <FileMapContext.Provider value={fileMap}>
        <AssistantsMapContext.Provider value={assistantsMap}>
          <AgentsMapContext.Provider value={agentsMap}>
            <PromptGroupsProvider>
              <Banner onHeightChange={setBannerHeight} />
              <div className="flex" style={{ height: `calc(100dvh - ${bannerHeight}px)` }}>
                <div className="relative z-0 flex h-full w-full overflow-hidden">
                  <UnifiedSidebar />
                  <div
                    className="relative flex h-full max-w-full flex-1 flex-col overflow-hidden"
                    style={{
                      transform:
                        isSmallScreen && sidebarExpanded ? 'translateX(min(85vw, 380px))' : 'none',
                      transition: 'transform 300ms cubic-bezier(0.2, 0, 0, 1)',
                    }}
                    inert={isSmallScreen && sidebarExpanded ? '' : undefined}
                  >
                    <Outlet />
                  </div>
                </div>
              </div>
            </PromptGroupsProvider>
          </AgentsMapContext.Provider>
          {config?.interface?.termsOfService?.modalAcceptance === true && (
            <TermsAndConditionsModal
              open={showTerms}
              onOpenChange={setShowTerms}
              onAccept={handleAcceptTerms}
              onDecline={handleDeclineTerms}
              title={config.interface.termsOfService.modalTitle}
              modalContent={config.interface.termsOfService.modalContent}
            />
          )}
          {/**
           * ai-aflat: the one-time consent gate. Mounted here rather than in the
           * chat view because it must block *every* authenticated route and
           * survive conversation switches — this shell renders once per session.
           */}
          <ConsentModal />
          <KeyboardShortcutsProvider />
        </AssistantsMapContext.Provider>
      </FileMapContext.Provider>
    </SetConvoProvider>
  );
}
