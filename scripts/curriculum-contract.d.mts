export type CsvRow = string[];
export type Catalog = Map<string, CsvRow>;
export type Manifest = {
  manifest_version: number;
  curriculum_version: string;
  publication_status: string;
  coverage_file: string;
  coverage_sha256: string;
  prerequisites_file: string;
  prerequisites_sha256: string;
  id_registry_file: string;
  id_registry_sha256: string;
  dependency_semantics: string;
  included_tracks: string[];
  selected_subset_tracks: string[];
};
export type IdRegistry = { schema_version: number; ids: string[] };
export type Graph = {
  schema_version: number;
  nodes: { skill_id: string; prerequisites: string[] }[];
};

export const headers: string[];
export function parseCsv(input: string): CsvRow[];
export function validateManifest(
  manifest: Manifest,
  files: Map<string, string>
): void;
export function resolveRepositoryPath(root: string, path: string): string;
export function validateCatalog(
  records: CsvRow[],
  knownSources: Set<string>,
  registryIds: Set<string>
): Catalog;
export function validateIdRegistry(
  registry: IdRegistry,
  catalog: Catalog,
  previousIds?: string[]
): void;
export function validateIdRegistryShape(value: unknown): string[];
export function columnIndex(name: string): number;
export function validatePublicationStatus(
  manifest: Manifest,
  catalog: Catalog
): void;
export function validateGraph(graph: Graph, catalog: Catalog): number;
export function validateBundle(
  root: string,
  previousIds?: string[]
): {
  manifest: Manifest;
  records: CsvRow[];
  catalog: Catalog;
  registry: IdRegistry;
  graph: Graph;
  edges: number;
};
