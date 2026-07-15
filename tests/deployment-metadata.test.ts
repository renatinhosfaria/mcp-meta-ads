import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDeploymentMetadata } from '../src/deployment-metadata.ts';

test('resolveDeploymentMetadata reads identifiers supplied by the deployment', () => {
  const metadata = resolveDeploymentMetadata({
    GIT_SHA: '2664678-full-sha',
    BUILD_TIME: '2026-07-15T12:00:00.000Z',
    DEPLOYMENT_ID: 'swarm-service-42',
  });

  assert.deepEqual(metadata, {
    version: '1.0.1',
    gitSha: '2664678-full-sha',
    buildTime: '2026-07-15T12:00:00.000Z',
    deploymentId: 'swarm-service-42',
  });
});

test('resolveDeploymentMetadata reports unknown identifiers when build metadata is absent', () => {
  assert.deepEqual(resolveDeploymentMetadata({}), {
    version: '1.0.1',
    gitSha: 'unknown',
    buildTime: 'unknown',
    deploymentId: 'unknown',
  });
});
