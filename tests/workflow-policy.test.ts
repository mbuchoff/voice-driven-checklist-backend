import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { parse } from 'yaml';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

const stepSchema = z
  .object({
    if: z.string().optional(),
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
    expect(planJob?.environment).toBe('infrastructure-plan');
    expect(planJob?.permissions).toMatchObject({ 'id-token': 'write' });
    expect(runs(configuration)).toMatch(/tofu .* plan -lock=false/);
    expect(runs(configuration)).not.toContain('tofu apply');
    expect(usedActions(configuration).join('\n')).not.toContain('upload-artifact');
  });

  it.each(['infrastructure-plan', 'deploy-development'])(
    'pipes every plan directly to the policy checker in %s',
    async (name) => {
      const commands = runs(await workflow(name));
      const lines = commands.split('\n');
      const pipelines = lines
        .map((line, index) => ({ index, line }))
        .filter(({ line }) => line.includes(' show -json '))
        .map(({ index }) => lines.slice(index, index + 8).join('\n'));

      expect(pipelines).not.toEqual([]);
      for (const pipeline of pipelines) {
        expect(pipeline).toContain('check-infrastructure-policy.ts');
        expect(pipeline).toMatch(/\n\s+- \\/);
        expect(pipeline).not.toMatch(/\n\s*>\s/);
      }
    },
  );

  it('runs a speculative infrastructure plan for every pull request', async () => {
    const configuration = await workflow('infrastructure-plan');

    expect(configuration.on.pull_request).toEqual({});
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

  it('requires an explicit manual input before deleting reconstructable resources', async () => {
    const configuration = await workflow('deploy-development');
    const commands = runs(configuration);

    expect(commands).toContain('inputs.allow_reconstructable_destroy');
    expect(commands).not.toContain('github.event_name');
  });

  it('closes a GitHub Deployment when a run is cancelled', async () => {
    const configuration = await workflow('deploy-development');
    const failedStatusJob = configuration.jobs.deploy?.steps.find((step) =>
      step.run?.includes('state=failure'),
    );

    expect(failedStatusJob?.if).toContain('cancelled()');
  });

  it('keeps advisory-database checks out of the deterministic deployment path', async () => {
    const deployment = await workflow('deploy-development');
    const continuousIntegration = await workflow('ci');

    expect(runs(deployment)).not.toContain('npm audit');
    expect(runs(continuousIntegration)).toContain('npm audit');
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
    expect(commands).toContain('check-deployment-provenance.ts');
  });

  it('records the immutable Actions run in deployment provenance', async () => {
    const commands = runs(await workflow('deploy-development'));

    expect(commands).toContain(
      'https://github.com/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID',
    );
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
