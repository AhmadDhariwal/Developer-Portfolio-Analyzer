import { OrganizationDirectoryMember } from '../../../shared/models/organization-governance.model';
export function deduplicateOrganizationMembers(
  rows: OrganizationDirectoryMember[],
): OrganizationDirectoryMember[] {
  const users = new Map<string, OrganizationDirectoryMember>();
  for (const row of rows) {
    const previous = users.get(row._id);
    const teams = new Map(
      [...(previous?.teams || []), ...row.teams].map((team) => [team._id, team]),
    );
    users.set(row._id, { ...previous, ...row, teams: [...teams.values()] });
  }
  return [...users.values()].sort((left, right) => left.name.localeCompare(right.name));
}
