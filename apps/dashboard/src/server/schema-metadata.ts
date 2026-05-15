import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildSchema, isInterfaceType, isObjectType, type GraphQLFieldMap } from 'graphql';

export interface SchemaFieldMeta {
  typeName: string;
  fieldName: string;
  deprecated: boolean;
  deprecationReason: string | null;
}

interface SchemaCache {
  loadedAt: number;
  fields: SchemaFieldMeta[];
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let schemaCache: SchemaCache | null = null;

export async function getSchemaFieldMetadata(): Promise<SchemaFieldMeta[]> {
  const now = Date.now();
  if (schemaCache && now - schemaCache.loadedAt < CACHE_TTL_MS) {
    return schemaCache.fields;
  }

  const schemaPath = process.env.SCHEMA_SDL_PATH
    ? process.env.SCHEMA_SDL_PATH
    : path.resolve(process.cwd(), '..', '..', 'schema.graphql');

  const sdl = await readFile(schemaPath, 'utf8');
  const schema = buildSchema(sdl);
  const fields: SchemaFieldMeta[] = [];

  for (const type of Object.values(schema.getTypeMap())) {
    if (type.name.startsWith('__')) {
      continue;
    }

    if (!isObjectType(type) && !isInterfaceType(type)) {
      continue;
    }

    for (const [fieldName, field] of Object.entries(type.getFields() as GraphQLFieldMap<unknown, unknown>)) {
      fields.push({
        typeName: type.name,
        fieldName,
        deprecated: field.deprecationReason != null,
        deprecationReason: field.deprecationReason ?? null,
      });
    }
  }

  schemaCache = {
    loadedAt: now,
    fields,
  };

  return fields;
}

