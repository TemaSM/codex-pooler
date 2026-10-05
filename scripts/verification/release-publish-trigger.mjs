import { appendFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const releaseVersion = /^(?:codex-pooler-)?v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$/;
const requiredStatus = "continuous-integration/drone/push";

function validTag(tag) {
	return typeof tag === "string" && releaseVersion.test(tag);
}

function releaseForTag(releases, tag) {
	return releases.find((release) => release.tag_name === tag && !release.draft);
}

export function selectPublicationTrigger(eventName, event, refs, releases) {
	if (eventName === "status") {
		if (event.context !== requiredStatus || event.state !== "success")
			return { publish: false, reason: "irrelevant_status" };
		if (!/^[a-f0-9]{40}$/.test(event.sha ?? ""))
			throw new Error("status event does not contain a valid revision");
		const candidates = refs.filter(
			(ref) => ref.sha === event.sha && validTag(ref.tag) && releaseForTag(releases, ref.tag),
		);
		if (candidates.length === 0)
			return { publish: false, reason: "published_release_not_found" };
		if (candidates.length !== 1)
			throw new Error("revision maps to multiple published release tags");
		return {
			publish: true,
			reason: "drone_status_succeeded",
			releaseTag: candidates[0].tag,
			revision: event.sha,
		};
	}

	if (eventName !== "workflow_dispatch" && eventName !== "push")
		return { publish: false, reason: "unsupported_event" };
	const source = eventName === "workflow_dispatch" ? event.inputs?.tag : event.ref;
	const tag = source?.replace(/^refs\/tags\//, "");
	if (!validTag(tag)) throw new Error("event does not contain a complete release version tag");
	const matches = refs.filter((ref) => ref.tag === tag);
	if (matches.length !== 1) throw new Error("release tag does not resolve to exactly one revision");
	if (!releaseForTag(releases, tag))
		return { publish: false, reason: "published_release_not_found" };
	return {
		publish: true,
		reason: "release_available",
		releaseTag: tag,
		revision: matches[0].sha,
	};
}

function localTagRefs() {
	const tags = execFileSync("git", ["tag", "--list"], { encoding: "utf8" })
		.split("\n")
		.filter(Boolean);
	return tags.map((tag) => ({
		tag,
		sha: execFileSync("git", ["rev-list", "-n", "1", tag], { encoding: "utf8" }).trim(),
	}));
}

async function main(args) {
	if (args.length !== 4)
		throw new Error("usage: release-publish-trigger.mjs EVENT_NAME EVENT_JSON RELEASES_JSON GITHUB_OUTPUT");
	const [eventName, eventPath, releasesPath, output] = args;
	const [event, pages] = await Promise.all([
		readFile(eventPath, "utf8").then(JSON.parse),
		readFile(releasesPath, "utf8").then(JSON.parse),
	]);
	const releases = Array.isArray(pages[0]) ? pages.flat() : pages;
	const result = selectPublicationTrigger(eventName, event, localTagRefs(), releases);
	const lines = [`publish=${result.publish}`, `reason=${result.reason}`];
	if (result.releaseTag) lines.push(`release_tag=${result.releaseTag}`);
	if (result.revision) lines.push(`revision=${result.revision}`);
	await appendFile(output, `${lines.join("\n")}\n`);
	console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main(process.argv.slice(2));
}

