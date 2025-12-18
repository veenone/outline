import { z } from "zod";
import { BaseSchema } from "@server/routes/api/schema";

export const AuthenticationProvidersInfoSchema = BaseSchema.extend({
  body: z.object({
    /** Authentication Provider Id */
    id: z.string().uuid(),
  }),
});

export type AuthenticationProvidersInfoReq = z.infer<
  typeof AuthenticationProvidersInfoSchema
>;

const AuthenticationProviderSettingsSchema = z.object({
  /** Group ID to automatically assign newly synced users to */
  syncDefaultGroupId: z.string().uuid().nullish(),
});

export const AuthenticationProvidersUpdateSchema = BaseSchema.extend({
  body: z.object({
    /** Authentication Provider Id */
    id: z.string().uuid(),

    /** Whether the Authentication Provider is enabled or not */
    isEnabled: z.boolean().optional(),

    /** Provider-specific settings */
    settings: AuthenticationProviderSettingsSchema.optional(),
  }),
});

export type AuthenticationProvidersUpdateReq = z.infer<
  typeof AuthenticationProvidersUpdateSchema
>;
