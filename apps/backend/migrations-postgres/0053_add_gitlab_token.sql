ALTER TABLE "context_recommendation_config" ADD COLUMN "repo_provider" text CHECK ("repo_provider" IN ('github', 'gitlab'));--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "gitlab_access_token" text;
