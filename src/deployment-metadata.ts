export const SERVICE_VERSION = '1.0.1';

export type DeploymentMetadata = {
  version: string;
  gitSha: string;
  buildTime: string;
  deploymentId: string;
};

export function resolveDeploymentMetadata(
  env: NodeJS.ProcessEnv = process.env,
): DeploymentMetadata {
  return {
    version: SERVICE_VERSION,
    gitSha: env.GIT_SHA || 'unknown',
    buildTime: env.BUILD_TIME || 'unknown',
    deploymentId: env.DEPLOYMENT_ID || 'unknown',
  };
}
