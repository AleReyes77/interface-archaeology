/**
 * Public project links. Forks can point them at their own repository with
 * NEXT_PUBLIC_REPOSITORY_URL; an empty value hides the GitHub links.
 */
export const DEFAULT_REPOSITORY_URL = "https://github.com/AleReyes77/interface-archaeology";

const configured = process.env.NEXT_PUBLIC_REPOSITORY_URL;

export const site = {
  name: "Interface Archaeology",
  tagline: "Understand the code beneath the interface.",
  repositoryUrl: configured === undefined ? DEFAULT_REPOSITORY_URL : configured || null,
};

export function repoLink(path = ""): string | null {
  return site.repositoryUrl ? `${site.repositoryUrl.replace(/\/$/, "")}${path}` : null;
}
