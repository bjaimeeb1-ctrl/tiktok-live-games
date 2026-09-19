/**
 * tiktokEventNormalizer.js
 * Pure functions that normalize raw tiktok-live-connector payloads
 * into a consistent shape for downstream consumers (games, bridge, debug).
 *
 * @module lib/tiktokEventNormalizer
 */

/**
 * Extract consistent user object from raw TikTok data.
 * Supports both legacy flat payloads and the v2 nested `user` payload.
 * @param {Object} raw - Raw event data from tiktok-live-connector
 * @returns {{uniqueId: string, nickname: string, profilePictureUrl: string}}
 */
export function normalizeUser(raw = {}) {
	const source = raw.user || raw;
	return {
		uniqueId: source.uniqueId || source.unique_id || "",
		nickname: source.nickname || source.uniqueId || source.unique_id || "Anonymous",
		profilePictureUrl:
			source.profilePictureUrl ||
			source.profile_picture_url ||
			source.avatarThumb ||
			"",
	};
}

/** Normalize chat event. */
export function normalizeChat(raw = {}) {
	return {
		user: normalizeUser(raw),
		comment: String(raw.comment || raw.content || raw.text || "").toLowerCase().trim(),
		timestamp: Date.now(),
	};
}

/** Normalize like event. */
export function normalizeLike(raw = {}) {
	return {
		user: normalizeUser(raw),
		likeCount: Number(raw.likeCount || raw.count || raw.like_count || 0),
		totalLikeCount: Number(raw.totalLikeCount || raw.total_like_count || 0),
		timestamp: Date.now(),
	};
}

/** Normalize share event. */
export function normalizeShare(raw = {}) {
	return {
		user: normalizeUser(raw),
		timestamp: Date.now(),
	};
}

/** Categorize gift by diamond value. */
export function categorizeGift(value) {
	if (value >= 100) return "large";
	if (value >= 10) return "medium";
	return "small";
}

/** Normalize gift event. */
export function normalizeGift(raw = {}) {
	const giftValue = Number(
		raw.diamondCount ||
		raw.giftValue ||
		raw.gift?.diamondCount ||
		raw.gift?.diamond_count ||
		1,
	);
	return {
		user: normalizeUser(raw),
		giftId: Number(raw.giftId || raw.gift?.id || raw.gift?.giftId || 0),
		giftName:
			raw.giftName ||
			raw.giftDetails?.giftName ||
			raw.gift?.name ||
			raw.gift?.giftName ||
			"Unknown Gift",
		giftValue,
		repeatCount: Number(raw.repeatCount || raw.repeat_count || 1),
		giftType: categorizeGift(giftValue),
		timestamp: Date.now(),
	};
}
