import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { parse } from 'yaml';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

const stepSchema = z
  .object({
    if: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    name: z.string().optional(),
    run: z.string().optional(),
    uses: z.string().optional(),
    with: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

const jobSchema = z
  .object({
    environment: z.union([z.string(), z.object({ name: z.string() }).loose()]).optional(),
    if: z.string().optional(),
    needs: z.union([z.string(), z.array(z.string())]).optional(),
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
    const planJob = configuration.jobs['plan-infrastructure'];

    expect(configuration.on).toHaveProperty('pull_request');
    expect(planJob?.if).toContain('head.repo.full_name == github.repository');
    expect(planJob?.environment).toBe('infrastructure-plan');
    expect(planJob?.permissions).toMatchObject({ 'id-token': 'write' });
    expect(runs(configuration)).toMatch(/tofu .* plan -lock=false/);
    expect(runs(configuration)).not.toContain('tofu apply');
    expect(usedActions(configuration).join('\n')).not.toContain('upload-artifact');
  });

  it.each(['success', 'failure', 'cancelled', 'skipped'])(
    'makes the required plan check fail closed when infrastructure result is %s',
    async (result) => {
      const configuration = await workflow('infrastructure-plan');
      const gate = configuration.jobs.plan;

      // GitHub accepts skipped required checks. Keep the credential-bearing job
      // fork-guarded, but evaluate its result in an unconditional, unprivileged job.
      expect(gate?.needs).toBe('plan-infrastructure');
      expect(gate?.if).toBe('${{ always() }}');
      expect(gate?.permissions).toEqual({});
      expect(gate?.environment).toBeUndefined();
      expect(gate?.steps).toHaveLength(1);
      const step = gate?.steps[0];
      expect(step?.env?.PLAN_RESULT).toBe('${{ needs.plan-infrastructure.result }}');
      expect(step?.run).toBeDefined();
      const execution = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', step?.run ?? ''], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH, PLAN_RESULT: result },
      });
      expect(execution.error).toBeUndefined();
      expect(execution.status).toBe(result === 'success' ? 0 : 1);
    },
  );

  it.each(['infrastructure-plan', 'deploy-development'])(
    'pipes every plan directly to the policy checker in %s',
    async (name) => {
      const configuration = await workflow(name);
      const planSteps = Object.values(configuration.jobs)
        .flatMap((job) => job.steps)
        .filter((step) => step.run?.includes(' show -json '));

      expect(planSteps).not.toEqual([]);
      for (const step of planSteps) {
        const pipelines = (step.run ?? '')
          .replace(/\\\n\s*/g, ' ')
          .split('\n')
          .filter((line) => line.includes(' show -json '));

        expect(pipelines).not.toEqual([]);
        for (const pipeline of pipelines) {
          expect(pipeline).toMatch(
            /check-infrastructure-policy\.ts"?\s+-\s+/,
          );
          expect(pipeline).not.toMatch(/(?:^|\s)(?:>|tee)(?:\s|$)/);
        }
      }
    },
  );

  it.each(['infrastructure-plan', 'deploy-development'])(
    'checks out and installs trusted policy only after candidate execution in %s',
    async (name) => {
      const configuration = await workflow(name);
      const steps = Object.values(configuration.jobs).flatMap((job) => job.steps);
      const policyCheckout = steps.findIndex((step) =>
        step.name?.includes('trusted policy') ||
        step.name?.includes('main-owned deployment policy'),
      );
      const policyInstall = steps.findIndex((step) =>
        step.run?.includes('npm --prefix policy ci'),
      );
      const checker = steps.findIndex(
        (step, index) =>
          index > policyInstall &&
          step.run?.includes('check-infrastructure-policy.ts'),
      );
      const lastCandidateExecution = steps.reduce(
        (last, step, index) =>
          step.run?.includes('npm --prefix candidate') ||
          step.run?.includes('npm run build') ||
          step.run?.match(/tofu -chdir=(?:candidate\/)?infra\/aws\/\S+ plan /)
            ? index
            : last,
        -1,
      );

      expect(lastCandidateExecution).toBeGreaterThanOrEqual(0);
      expect(policyCheckout).toBeGreaterThan(lastCandidateExecution);
      expect(policyInstall).toBeGreaterThan(policyCheckout);
      expect(checker).toBeGreaterThan(policyInstall);
    },
  );

  it('pins speculative plan policy to main with a PR-1-only bootstrap fallback', async () => {
    const configuration = await workflow('infrastructure-plan');
    const policyCheckout = configuration.jobs['plan-infrastructure']?.steps.find((step) =>
      step.name?.includes('trusted policy'),
    );
    const policyInstall = configuration.jobs['plan-infrastructure']?.steps.find((step) =>
      step.run?.includes('POLICY_ROOT'),
    );

    expect(policyCheckout?.with?.ref).toBe('main');
    expect(policyInstall?.run).toMatch(/pull_request\.number.*==.*1/);
    expect(policyInstall?.run).toContain('exit 1');
  });

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
    const guardedPlan = configuration.jobs.deploy?.steps.find((step) =>
      step.run?.includes('allow_reconstructable_destroy'),
    );

    expect(guardedPlan?.run).toContain('inputs.allow_reconstructable_destroy');
    expect(guardedPlan?.run).toContain(
      'override+=(--allow-reconstructable-destroy)',
    );
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
