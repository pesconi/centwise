import { z } from "zod";

export const userSchema = z.object({
    email: z.string().trim().email().max(320).toLowerCase()
});

export const credentialsSchema = userSchema.extend({
    password: z.string().min(12).max(128)
});

export type CreateUserInput = z.infer<typeof userSchema>;
export type CredentialsInput = z.infer<typeof credentialsSchema>;