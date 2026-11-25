import { defineRailway, project, service } from "railway/iac";
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "any-ai";
export default defineRailway(() => {
  const anyAi = service("any-ai", {
    // Generator emitted RAILPACK; the live service builds from the Dockerfile.
    build: { builder: "DOCKERFILE", dockerfilePath: "docker/Dockerfile" },
    healthcheck: "/api/health",
    deploy: { restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 3 },
    replicas: { "us-west2": 1 },
  });

  return project("any-ai", {
    variables: { managed: false },
    resources: [anyAi],
  });
});
