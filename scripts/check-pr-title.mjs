import { pathToFileURL } from "node:url";

export function assertConventionalTitle(title) {
  if (!/^[a-z][a-z0-9-]*(\([^()\r\n]+\))?!?: \S[^\r\n]*$/.test(title ?? "")) {
    throw new Error(
      "Use a Conventional Commit PR title, for example 'fix: handle account switches', 'feat: add mail rules', or 'feat!: change the API'. Release Please uses the squash commit title to choose the next version.",
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  assertConventionalTitle(process.env.PR_TITLE);
}
