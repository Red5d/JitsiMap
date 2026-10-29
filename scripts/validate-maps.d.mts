// Type surface for validate-maps.mjs, for TypeScript consumers (tests).

export interface ValidationReport {
  errors: string[];
  warnings: string[];
}

export interface ValidateMapOptions {
  /** Directory relative tileset image paths resolve against (the map's dir). */
  baseDir?: string;
}

/** Validate a parsed Tiled JSON document. Empty `errors` = valid map. */
export function validateMap(map: unknown, options?: ValidateMapOptions): Promise<ValidationReport>;

export interface FileValidationReport extends ValidationReport {
  file: string;
}

/** Load and validate a `.tmj` file (JSON parse errors included). */
export function validateMapFile(file: string): Promise<FileValidationReport>;

/** All bundled maps: `public/maps/*.tmj`, templates excluded. */
export function defaultMapFiles(): Promise<string[]>;

export function main(argv?: string[]): Promise<number>;
