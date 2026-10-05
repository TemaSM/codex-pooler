import assert from "node:assert/strict";
import test from "node:test";
import { selectPublicationTrigger } from "../../scripts/verification/release-publish-trigger.mjs";

const sha = "a".repeat(40);
const otherSha = "b".repeat(40);
const refs = [
	{ tag: "codex-pooler-v0.10.8", sha },
	{ tag: "not-a-release", sha },
	{ tag: "codex-pooler-v0.10.7", sha: otherSha },
];
const releases = [
	{ tag_name: "codex-pooler-v0.10.8", draft: false, prerelease: false },
	{ tag_name: "codex-pooler-v0.10.7", draft: false, prerelease: false },
];

test("a successful Drone status selects the published release for its exact revision", () => {
	assert.deepEqual(
		selectPublicationTrigger(
			"status",
			{ context: "continuous-integration/drone/push", state: "success", sha },
			refs,
			releases,
		),
		{
			publish: true,
			reason: "drone_status_succeeded",
			releaseTag: "codex-pooler-v0.10.8",
			revision: sha,
		},
	);
});

test("unrelated and non-successful statuses are ignored", () => {
	for (const event of [
		{ context: "another-check", state: "success", sha },
		{ context: "continuous-integration/drone/push", state: "pending", sha },
		{ context: "continuous-integration/drone/push", state: "failure", sha },
	]) {
		assert.deepEqual(selectPublicationTrigger("status", event, refs, releases), {
			publish: false,
			reason: "irrelevant_status",
		});
	}
});

test("a successful status without a published release is deferred", () => {
	assert.deepEqual(
		selectPublicationTrigger(
			"status",
			{ context: "continuous-integration/drone/push", state: "success", sha },
			refs,
			[],
		),
		{ publish: false, reason: "published_release_not_found" },
	);
});

test("workflow dispatch selects a published release without waiting for CI", () => {
	assert.deepEqual(
		selectPublicationTrigger(
			"workflow_dispatch",
			{ inputs: { tag: "codex-pooler-v0.10.8" } },
			refs,
			releases,
		),
		{
			publish: true,
			reason: "release_available",
			releaseTag: "codex-pooler-v0.10.8",
			revision: sha,
		},
	);
});

test("a tag push accepts the full refs/tags form", () => {
	assert.equal(
		selectPublicationTrigger(
			"push",
			{ ref: "refs/tags/codex-pooler-v0.10.8" },
			refs,
			releases,
		).releaseTag,
		"codex-pooler-v0.10.8",
	);
});

test("invalid tags, revisions and ambiguous release tags fail closed", () => {
	assert.throws(() =>
		selectPublicationTrigger(
			"workflow_dispatch",
			{ inputs: { tag: "main" } },
			refs,
			releases,
		),
	);
	assert.throws(() =>
		selectPublicationTrigger(
			"status",
			{ context: "continuous-integration/drone/push", state: "success", sha: "bad" },
			refs,
			releases,
		),
	);
	assert.throws(() =>
		selectPublicationTrigger(
			"status",
			{ context: "continuous-integration/drone/push", state: "success", sha },
			[...refs, { tag: "v0.10.8", sha }],
			[...releases, { tag_name: "v0.10.8", draft: false, prerelease: false }],
		),
	);
});

