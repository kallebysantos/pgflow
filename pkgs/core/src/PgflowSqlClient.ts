import type postgres from 'postgres';
import type {
  StepTaskRecord,
  IPgflowClient,
  StepTaskKey,
  RunRow,
} from './types.js';
import type { Json } from './types.js';
import type { AnyFlow, ExtractFlowInput } from '@pgflow/dsl';

/**
 * Implementation of IPgflowClient that uses direct SQL calls to pgflow functions
 */
export class PgflowSqlClient<TFlow extends AnyFlow>
  implements IPgflowClient<TFlow>
{
  constructor(private readonly sql: postgres.Sql) {}

  async pollForTasks(
    queueName: string,
    batchSize = 20,
    maxPollSeconds = 5,
    pollIntervalMs = 200,
    visibilityTimeout = 2
  ): Promise<StepTaskRecord<TFlow>[]> {
    return await this.sql<StepTaskRecord<TFlow>[]>`
      SELECT *
      FROM pgflow.poll_for_tasks(
        queue_name => ${queueName},
        vt => ${visibilityTimeout},
        qty => ${batchSize},
        max_poll_seconds => ${maxPollSeconds},
        poll_interval_ms => ${pollIntervalMs}
      );
    `;
  }

  async completeTask(stepTask: StepTaskKey, output?: Json): Promise<void> {
    await this.sql`
      SELECT pgflow.complete_task(
        run_id => ${stepTask.run_id}::uuid,
        step_slug => ${stepTask.step_slug}::text,
        task_index => ${0}::int,
        output => ${this.sql.json(output || null)}::jsonb
      );
    `;
  }

  async failTask(stepTask: StepTaskKey, error: unknown): Promise<void> {
    const errorString =
      typeof error === 'string'
        ? error
        : error instanceof Error
        ? error.message
        : JSON.stringify(error);

    await this.sql`
      SELECT pgflow.fail_task(
        run_id => ${stepTask.run_id}::uuid,
        step_slug => ${stepTask.step_slug}::text,
        task_index => ${0}::int,
        error_message => ${errorString}::text
      );
    `;
  }

  async startFlow<TFlow extends AnyFlow>(
    flow: TFlow,
    input: ExtractFlowInput<TFlow>
  ): Promise<RunRow> {
    const results = await this.sql<RunRow[]>`
      SELECT * FROM pgflow.start_flow(${flow.slug}::text, ${this.sql.json(
      input
    )}::jsonb);
    `;

    if (results.length === 0) {
      throw new Error(`Failed to start flow ${flow.slug}`);
    }

    const [flowRun] = results;

    return flowRun;
  }
}
