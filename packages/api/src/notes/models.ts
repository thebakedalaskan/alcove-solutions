import { z } from '../shared/zod';
/** A model's ID as NEAR AI's catalog names it, e.g. "zai-org/GLM-4.5V". */
export const ModelIdSchema = z.string().min(1).max(200);

/** A model that can do the AI work (notes, reading shared screens), as the catalog names it. `private` is true when it runs in a secure enclave. */
export const AiModelSchema = z.object({ id: ModelIdSchema, name: z.string(), private: z.boolean() });

export type AiModel = z.infer<typeof AiModelSchema>;

/** The models to choose from, and the one used when nobody chooses. */
export const AiModelsSchema = z.object({ default: AiModelSchema, models: z.array(AiModelSchema) });

export type AiModels = z.infer<typeof AiModelsSchema>;

/** A time something went to a model outside a secure enclave, and what for. */
export const UnencryptedUseSchema = z.object({ model: ModelIdSchema, task: z.enum(['notes', 'screens']), at: z.string() });

export type UnencryptedUse = z.infer<typeof UnencryptedUseSchema>;

/** The models to choose from for the AI work. */
export interface ModelsApi {
  /** The models to choose from for the AI work, and the default one. */
  list(): Promise<AiModels>;
}
