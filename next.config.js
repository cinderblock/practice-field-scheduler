/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
	allowedDevOrigins: [process.env.NEXTAUTH_URL?.replace("https://", "") ?? "localhost"],
	images: {
		remotePatterns: [
			{
				protocol: "https",
				hostname: "avatars.slack-edge.com",
			},
			{
				protocol: "https",
				hostname: "secure.gravatar.com",
			},
		],
	},
};

export default config;
