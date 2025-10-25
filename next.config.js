/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

const NextAuthURL = process.env.NEXTAUTH_URL;

/** @type {import("next").NextConfig} */
const config = {
	productionBrowserSourceMaps: process.env.ENABLE_SOURCEMAPS === "true",
	allowedDevOrigins: [NextAuthURL?.replace("https://", "") ?? "localhost"],
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

console.log(`Public URL: ${NextAuthURL ?? "http://localhost:3000"}`);

export default config;
