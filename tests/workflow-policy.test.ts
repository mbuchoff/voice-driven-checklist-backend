import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { parse } from 'yaml';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

const stepSchema = z
  .object({
    run: z.string().optional(),
    uses: z.string().optional(),
    with: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

const jobSchema = z
  .object({
    environment: z.union([z.string(), z.object({ name: z.string() }).loose()]).optional(),
    if: z.string().optional(),
    permissions: z.record(z.string(), z.string()).optional(),
    steps: z.array(stepSchema),
  })
  .loose();

const workflowSchema = z
  .object({
    jobs: z.record(z.string(), jobSchema),
    on: z.record(z.string(), z.unknown()),
    permissions: z.record(z.string(), z.string()).optional(),
  })
  .loose();

type Workflow = z.infer<typeof workflowSchema>;

async function workflow(name: string): Promise<Workflow> {
  const source = await readFile(resolve(`.github/workflows/${name}.yml`), 'utf8');
  return workflowSchema.parse(parse(source) as unknown);
}

function runs(configuration: Workflow): string {
  return Object.values(configuration.jobs)
    .flatMap((job) => job.steps.flatMap((step) => step.run ?? []))
    .join('\n');
}

function usedActions(configuration: Workflow): string[] {
  return Object.values(configuration.jobs).flatMap((job) =>
    job.steps.flatMap((step) => step.uses ?? []),
  );
}

describe('GitHub Actions policy', () => {
  it('runs trusted pull-request plans without giving forks AWS credentials', async () => {
    const configuration = await workflow('infrastructure-plan');
    const planJob = configuration.jobs.plan;

    expect(configuration.on).toHaveProperty('pull_request');
    expect(planJob?.if).toContain('head.repo.full_name == github.repository');
    expect(planJob?.permissions).toMatchObject({ 'id-token': 'write' });
    expect(runs(configuration)).toMatch(/tofu .* plan -lock=false/);
    expect(runs(configuration)).not.toContain('tofu apply');
    expect(usedActions(configuration).join('\n')).not.toContain('upload-artifact');
  });

  it('keeps selected-ref development applies backend-only and policy-gated', async () => {
    const configuration = await workflow('deploy-development');
    const deploymentJob = configuration.jobs.deploy;
    const commands = runs(configuration);

    expect(configuration.on).toHaveProperty('push');
    expect(configuration.on).toHaveProperty('workflow_dispatch');
    expect(deploymentJob?.environment).toBe('development');
    expect(commands).toContain('infra/aws/backend');
    expect(commands).not.toContain('infra/aws/auth');
    expect(commands).not.toContain('infra/aws/bootstrap');
    expect(commands).toContain('check-infrastructure-policy.ts');
    expect(commands).toMatch(/tofu .* apply/);
  });

  it('retains the exact development artifact for the accepted 90-day window', async () => {
    const configuration = await workflow('deploy-development');
    const upload = Object.values(configuration.jobs)
      .flatMap((job) => job.steps)
      .find((step) => step.uses?.includes('actions/upload-artifact'));

    expect(upload?.with).toMatchObject({
      'retention-days': 90,
    });
  });

  it('verifies the immutable Lambda version selected by the active alias', async () => {
    const configuration = await workflow('deploy-development');
    const commands = runs(configuration);

    expect(commands).toContain(
      'function_version=$(jq -r .FunctionVersion <<< "$alias")',
    );
    expect(commands).toContain('--qualifier "$function_version"');
  });

  it.each(['ci', 'infrastructure-plan', 'deploy-development'])(
    'pins every third-party action in %s to a full commit SHA',
    async (name) => {
      const configuration = await workflow(name);

      expect(usedActions(configuration)).not.toEqual([]);
      for (const action of usedActions(configuration)) {
        expect(action).toMatch(/^[^@]+@[0-9a-f]{40}$/);
      }
    },
  );
});
