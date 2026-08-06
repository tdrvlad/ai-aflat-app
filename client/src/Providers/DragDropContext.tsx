import React, { createContext, useContext, useMemo } from 'react';
import { isAgentsEndpoint, resolveEndpointType } from 'librechat-data-provider';
import type { EModelEndpoint } from 'librechat-data-provider';
import { useGetEndpointsQuery, useGetAgentByIdQuery } from '~/data-provider';
import { useAgentsMapContext } from './AgentsMapContext';
import { useAuthContext } from '~/hooks/AuthContext';
import { useChatContext } from './ChatContext';

interface DragDropContextValue {
  conversationId: string | null | undefined;
  agentId: string | null | undefined;
  endpoint: string | null | undefined;
  endpointType?: EModelEndpoint | string | undefined;
  useResponsesApi?: boolean;
}

const DragDropContext = createContext<DragDropContextValue | undefined>(undefined);

export function DragDropProvider({ children }: { children: React.ReactNode }) {
  const { conversation } = useChatContext();
  const { isAuthenticated } = useAuthContext();
  /**
   * Gated like ChatRoute's own copy: on the anonymous surface this query can
   * only 401, and the repeated 401s were feeding the auth-recovery redirect
   * that reloaded the page mid-sign-in (2026-08-06).
   */
  const { data: endpointsConfig } = useGetEndpointsQuery({ enabled: isAuthenticated });
  const agentsMap = useAgentsMapContext();

  const needsAgentFetch = useMemo(() => {
    const isAgents = isAgentsEndpoint(conversation?.endpoint);
    if (!isAgents || !conversation?.agent_id) {
      return false;
    }
    const agent = agentsMap?.[conversation.agent_id];
    return !agent?.model_parameters;
  }, [conversation?.endpoint, conversation?.agent_id, agentsMap]);

  const { data: agentData } = useGetAgentByIdQuery(conversation?.agent_id, {
    enabled: needsAgentFetch,
  });

  const agentProvider = useMemo(() => {
    const isAgents = isAgentsEndpoint(conversation?.endpoint);
    if (!isAgents || !conversation?.agent_id) {
      return undefined;
    }
    return agentData?.provider ?? agentsMap?.[conversation.agent_id]?.provider;
  }, [conversation?.endpoint, conversation?.agent_id, agentData, agentsMap]);

  const endpointType = useMemo(
    () => resolveEndpointType(endpointsConfig, conversation?.endpoint, agentProvider),
    [endpointsConfig, conversation?.endpoint, agentProvider],
  );

  const useResponsesApi = useMemo(() => {
    const isAgents = isAgentsEndpoint(conversation?.endpoint);
    if (!isAgents || !conversation?.agent_id || conversation?.useResponsesApi !== undefined) {
      return conversation?.useResponsesApi;
    }
    return (
      agentData?.model_parameters?.useResponsesApi ??
      agentsMap?.[conversation.agent_id]?.model_parameters?.useResponsesApi
    );
  }, [
    conversation?.endpoint,
    conversation?.agent_id,
    conversation?.useResponsesApi,
    agentData,
    agentsMap,
  ]);

  /** Context value only created when conversation fields change */
  const contextValue = useMemo<DragDropContextValue>(
    () => ({
      conversationId: conversation?.conversationId,
      agentId: conversation?.agent_id,
      endpoint: conversation?.endpoint,
      endpointType: endpointType,
      useResponsesApi: useResponsesApi,
    }),
    [
      conversation?.conversationId,
      conversation?.agent_id,
      conversation?.endpoint,
      useResponsesApi,
      endpointType,
    ],
  );

  return <DragDropContext.Provider value={contextValue}>{children}</DragDropContext.Provider>;
}

const defaultDragDropValue: DragDropContextValue = {
  conversationId: undefined,
  agentId: undefined,
  endpoint: undefined,
  endpointType: undefined,
  useResponsesApi: undefined,
};

export function useDragDropContext() {
  return useContext(DragDropContext) ?? defaultDragDropValue;
}
