'use client';

import { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useStartAnalysis } from '@/lib/hooks/use-start-analysis';
import {
  fetchFlowRunData,
  observeFlowRun,
  ResultRow,
  RunRow,
  StepStateRow,
  StepTaskRow,
} from '@/lib/db';
import {
  RealtimePostgresUpdatePayload,
  RealtimePostgresInsertPayload,
} from '@supabase/supabase-js';
import { createClient } from '@/utils/supabase/client';
import { useLoadingState } from './loading-state-provider';

interface FlowRunContextType {
  runData: ResultRow | null;
  loading: boolean;
  error: string | null;
  currentTime: Date;
  analyzeWebsite: (url: string) => Promise<void>;
  analyzeLoading: boolean;
  analyzeError: string | null;
}

const FlowRunContext = createContext<FlowRunContextType>({
  runData: null,
  loading: true,
  error: null,
  currentTime: new Date(),
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  analyzeWebsite: async () => {},
  analyzeLoading: false,
  analyzeError: null,
});

export const useFlowRun = () => useContext(FlowRunContext);

interface FlowRunProviderProps {
  runId: string;
  children: React.ReactNode;
}

export function FlowRunProvider({ runId, children }: FlowRunProviderProps) {
  // Split the state into separate pieces
  const [run, setRun] = useState<RunRow | null>(null);
  const [stepStates, setStepStates] = useState<Record<string, StepStateRow>>(
    {},
  );
  const [stepTasks, setStepTasks] = useState<Record<string, StepTaskRow[]>>({});

  // Create a persistent mapping of step_slug to step_index
  // This is cached once when the data is loaded and never changes
  const [stepOrderMap, setStepOrderMap] = useState<Record<string, number>>({});

  // UI state
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState<Date>(new Date());

  const router = useRouter();
  const supabase = createClient();
  const { setLoading: setGlobalLoading } = useLoadingState();
  
  // Use the shared hook for starting analysis
  const { start: analyzeWebsite, isPending: analyzeLoading, error: analyzeError } = useStartAnalysis();

  // Derive runData from the separate state pieces
  const runData = useMemo<ResultRow | null>(() => {
    if (!run) return null;

    // Convert stepStates map to array
    const stepStatesArray = Object.values(stepStates);

    // Sort stepStatesArray using our permanent stepOrderMap
    stepStatesArray.sort((a, b) => {
      const aIndex = stepOrderMap[a.step_slug] || 0;
      const bIndex = stepOrderMap[b.step_slug] || 0;
      return aIndex - bIndex;
    });

    // Create a flat array of all step tasks
    const stepTasksArray = Object.values(stepTasks)
      .flat()
      .map((task) => {
        // Add step_index to each task for consistent sorting using our cached map
        return {
          ...task,
          step_index: stepOrderMap[task.step_slug] || 0,
        };
      });

    // Sort the step tasks using the step_index from our cached map
    stepTasksArray.sort((a, b) => {
      return (
        (stepOrderMap[a.step_slug] || 0) - (stepOrderMap[b.step_slug] || 0)
      );
    });

    // Combine everything into ResultRow format
    return {
      ...run,
      step_states: stepStatesArray,
      step_tasks: stepTasksArray,
    } as ResultRow;
  }, [run, stepStates, stepTasks]);




  useEffect(() => {
    if (!runId) return;
    
    setLoading(true);
    // Set global loading state to true when initially loading run data
    // It will be set to false when we detect a completed/failed state
    setGlobalLoading(true);

    // Set up handlers for real-time updates
    const handleStepStateUpdate = (
      payload: RealtimePostgresUpdatePayload<StepStateRow>,
    ) => {
      console.log('Step state updated:', payload);

      // When step state is updated, we don't need to preserve step_index anymore
      // because we have our cached stepOrderMap
      const updatedStepState = payload.new;

      setStepStates((prevStates) => ({
        ...prevStates,
        [updatedStepState.step_slug]: updatedStepState,
      }));
    };

    const handleStepTaskUpdate = (
      payload: RealtimePostgresUpdatePayload<StepTaskRow>,
    ) => {
      // Log appropriately for INSERT or UPDATE event
      const isInsert = !payload.old;
      console.log(`Step task ${isInsert ? 'created' : 'updated'}:`, payload);

      // Log important details about the new task
      if (
        payload.new.step_slug === 'summary' ||
        payload.new.step_slug === 'tags'
      ) {
        console.log(`Important task updated - ${payload.new.step_slug}:`, {
          status: payload.new.status,
          has_output: !!payload.new.output,
          output: payload.new.output,
        });
      }

      // Add step_index to the task from our cached stepOrderMap
      const newTask = {
        ...payload.new,
        step_index: stepOrderMap[payload.new.step_slug] || 0,
      };

      setStepTasks((prevTasksMap) => {
        const stepSlug = newTask.step_slug;
        const currentTasks = prevTasksMap[stepSlug] || [];

        // Check if this task already exists
        const taskIndex = currentTasks.findIndex(
          (task) => task.step_slug === newTask.step_slug,
        );

        let updatedTasks;
        if (taskIndex >= 0) {
          // Update existing task
          updatedTasks = [...currentTasks];
          updatedTasks[taskIndex] = newTask;
        } else {
          // Add new task
          updatedTasks = [...currentTasks, newTask];
        }

        return {
          ...prevTasksMap,
          [stepSlug]: updatedTasks,
        };
      });
    };

    const handleStepTaskInsert = (
      payload: RealtimePostgresInsertPayload<StepTaskRow>,
    ) => {
      console.log('Step task inserted:', payload);

      // Log important details about the new task
      if (
        payload.new.step_slug === 'summary' ||
        payload.new.step_slug === 'tags'
      ) {
        console.log(`Important task inserted - ${payload.new.step_slug}:`, {
          status: payload.new.status,
          has_output: !!payload.new.output,
        });
      }

      // Add step_index to the task from our cached stepOrderMap
      const newTask = {
        ...payload.new,
        step_index: stepOrderMap[payload.new.step_slug] || 0,
      };

      setStepTasks((prevTasksMap) => {
        const stepSlug = newTask.step_slug;
        const currentTasks = prevTasksMap[stepSlug] || [];

        return {
          ...prevTasksMap,
          [stepSlug]: [...currentTasks, newTask],
        };
      });
    };

    // Set up a subscription to get real-time updates
    const subscription = observeFlowRun({
      runId,
      onRunUpdate(payload: RealtimePostgresUpdatePayload<RunRow>) {
        console.log('Run updated:', payload);

        // When run is marked as completed, fetch all data again to ensure we have all step outputs
        if (payload.new.status === 'completed') {
          console.log(
            'Run completed - fetching full data to ensure we have all step outputs',
          );

          // Set global loading state to false when the run completes
          setGlobalLoading(false);

          // Fetch fresh data from API
          fetchFlowRunData(runId).then(({ data, error }) => {
            if (error) {
              console.error('Error fetching complete run data:', error);
            } else if (data) {
              console.log('Fetched complete run data:', data);
              // Update all state pieces with fresh data
              setRun({
                ...data,
                step_states: undefined,
                step_tasks: undefined,
              } as RunRow);

              // Convert step states array to a map
              const stateMap: Record<string, StepStateRow> = {};
              data.step_states.forEach((state) => {
                stateMap[state.step_slug] = state;
              });
              setStepStates(stateMap);

              // Group step tasks by step_slug and add step_index from our cached stepOrderMap
              const tasksMap: Record<string, StepTaskRow[]> = {};
              data.step_tasks.forEach((task) => {
                // Add step_index to task using our cached stepOrderMap
                const taskWithIndex = {
                  ...task,
                  step_index: stepOrderMap[task.step_slug] || 0,
                };

                if (!tasksMap[task.step_slug]) {
                  tasksMap[task.step_slug] = [];
                }
                tasksMap[task.step_slug].push(taskWithIndex);
              });
              setStepTasks(tasksMap);
            }
          });

          return;
        }

        // For other updates, update only the run data
        setRun(payload.new);
        
        // Turn off loading if the run fails
        if (payload.new.status === 'failed' || payload.new.status === 'error' || payload.new.status === 'cancelled') {
          setGlobalLoading(false);
        }
      },
      onStepStateUpdate: handleStepStateUpdate,
      onStepTaskUpdate: handleStepTaskUpdate,
      onStepTaskInsert: handleStepTaskInsert,
    });

    // Set up a timer to update the current time every second
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    // Load data after subscription is set up to avoid race conditions
    const loadData = async () => {      
      const { data, error } = await fetchFlowRunData(runId);

      if (error) {
        setError(error);
        setGlobalLoading(false);
      } else if (data) {
        // Initialize our separate state pieces from the fetched data
        setRun({
          ...data,
          step_states: undefined,
          step_tasks: undefined,
        } as RunRow);

        // If the run is already completed, turn off the global loading state
        if (data.status === 'completed' || data.status === 'failed' || 
            data.status === 'error' || data.status === 'cancelled') {
          setGlobalLoading(false);
        }

        // Create and cache the step order map from step_states
        // This is created once and never changes, ensuring consistent ordering
        const orderMap: Record<string, number> = {};
        data.step_states.forEach((state) => {
          if (state.step && state.step_slug) {
            orderMap[state.step_slug] = state.step.step_index || 0;
          }
        });
        setStepOrderMap(orderMap);

        // Convert step states array to a map keyed by step_slug
        const stateMap: Record<string, StepStateRow> = {};
        data.step_states.forEach((state) => {
          stateMap[state.step_slug] = state;
        });
        setStepStates(stateMap);

        // Group step tasks by step_slug
        const tasksMap: Record<string, StepTaskRow[]> = {};
        data.step_tasks.forEach((task) => {
          // Add step_index to task for consistent ordering
          const taskWithIndex = {
            ...task,
            step_index: orderMap[task.step_slug] || 0,
          };

          if (!tasksMap[task.step_slug]) {
            tasksMap[task.step_slug] = [];
          }
          tasksMap[task.step_slug].push(taskWithIndex);
        });
        setStepTasks(tasksMap);
      }

      setLoading(false);
    };

    // Load data after subscription is ready
    loadData();

    return () => {
      subscription.unsubscribe();
      clearInterval(timer);
    };
  }, [runId, router]);

  const value = {
    runData,
    loading,
    error,
    currentTime,
    analyzeWebsite,
    analyzeLoading,
    analyzeError,
  };

  return (
    <FlowRunContext.Provider value={value}>{children}</FlowRunContext.Provider>
  );
}
