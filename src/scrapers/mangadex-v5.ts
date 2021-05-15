import chalk from "chalk";
import fetch from "node-fetch-extra";
import { error } from "./index";
import { Chapter, ScraperError, ScraperResponse } from "../types";
import { Scraper, SearchOptions } from "./types";
import { getProviderId, isProviderId } from "../routers/manga-page";
import updateManga from "../util/updateManga";
import db from "../db";

export class mangadexClass extends Scraper {
	constructor() {
		super();
		this.provider = "Mangadex5";
		this.searchDisplay = "Mangadex";
		this.canSearch = true;
		this.nsfw = false;
	}

	public async search(query: string, options?: Partial<SearchOptions>) {
		// This is a better way of destructuring with default values
		// than doing it at the top. This took... many hours. Thanks Pandawan!
		const { resultCount } = {
			...options,
			resultCount: 12,
		};

		let pageUrl: string;

		if (query === "") {
			// Get popular page
			pageUrl = `https://api.mangadex.org/manga?limit=${resultCount}`;
		} else {
			pageUrl = `https://api.mangadex.org/manga?title=${encodeURIComponent(
				query
			)}&limit=${resultCount}`;
		}

		// Fetch DOM for relevant page
		const pageReq = await fetch(pageUrl);
		const data = await pageReq.json();

		// Get IDs from nodes
		const ids = data.results
			.map((result) => {
				return result.data.id;
			})
			.slice(0, resultCount);

		// Get details for each search result
		const searchResultData: ScraperResponse[] = await Promise.all(
			ids.map((id) => updateManga("mangadex5", id))
		);

		return searchResultData;
	}

	/**
	 * The scrape function
	 */
	public async scrape(slug: string, chapterId: string) {
		// Set a timeout for how long the request is allowed to take
		const maxTimeout: Promise<ScraperError> = new Promise((resolve) => {
			setTimeout(() => {
				resolve(error(0, "This request took too long"));
			}, 25e3);
		});

		// Attempt scraping series
		const scraping = this.doScrape(slug, chapterId);

		// Get first result of either scraping or timeout
		const raceResult = await Promise.race([maxTimeout, scraping]);

		// Check if it's the timeout instead of the scraped result
		if (
			raceResult.success === false &&
			raceResult.err === "This request took too long"
		) {
			console.error(
				chalk.red("[Mangadex]") +
					` A request for '${slug}' at '${chapterId}' took too long and has timed out`
			);
		}

		// Return result
		return raceResult;
	}

	private async doScrape(
		slug: string,
		chapterId: string
	): Promise<ScraperResponse> {
		try {
			// Retry because of rate limit
			let data = await getDataFromURL(`https://api.mangadex.org/manga/${slug}`);
			data = data.data;

			// Get title
			const title =
				data.attributes.title.en || Object.values(data.attributes.title)[0];

			// Set temporary poster URL :/
			let posterUrl = "https://i.imgur.com/6TrIues.jpg";

			// Get genres from tags
			const genres = data.attributes.tags.map((tag) => tag.attributes.name.en);

			// Get alternate titles
			const alternateTitles = data.attributes.altTitles.map((t) => t.en);

			// Get status
			const status = data.attributes.status.toLowerCase();

			// Get chapters
			let offset = 0;
			let total = Infinity;
			let allChapters = [];

			while (offset < total) {
				// Cycle through pagination
				const chapterData = await getDataFromURL(
					`https://api.mangadex.org/manga/${slug}/feed?offset=${offset}&limit=500&locales[]=en`
				);
				const mdChapters = (chapterData.results ?? [])
					.map((v) => (v.result === "ok" ? v.data : null))
					.filter(Boolean);

				total = chapterData.total;
				offset = chapterData.offset + chapterData.limit;

				allChapters = [...allChapters, ...mdChapters];
			}

			// Map fetched chapters into Adolla format

			let largestVolume = 0;
			for (let chapter of allChapters) {
				if (Number(chapter.attributes.volume) > largestVolume)
					largestVolume = Number(chapter.attributes.volume);
			}

			const allReadMdChapters = Object.keys(
				db.get(`reading_new.mangadex5.${slug}`) || {}
			);

			const chaptersWithDupes: Chapter[] = allChapters
				.map(
					(ch, i): Chapter => {
						const { attributes: a } = ch;
						const label =
							a.volume || a.chapter
								? `${a.volume ? `Vol ${a.volume}, ` : ""}chapter ${a.chapter}`
								: a.title;

						return {
							label: label.slice(0, 1).toUpperCase() + label.slice(1),
							chapter: a.chapter,
							season: a.volume || 0,
							date: a.publishAt,
							hrefString: ch.id,
							combined: Number(a.chapter)
								? Number(a.volume || largestVolume) * 1000 +
								  Number(a.chapter || "")
								: i,
						};
					}
				)
				.sort(
					(a, b) =>
						allReadMdChapters.indexOf(b.hrefString) -
						allReadMdChapters.indexOf(a.hrefString)
				);

			const chapterCombineds = [];
			const chapters = chaptersWithDupes
				.filter((chapter) => {
					if (!chapterCombineds.includes(chapter.combined)) {
						chapterCombineds.push(chapter.combined);
						return true;
					}
					return false;
				})
				.sort((a, b) => a.combined - b.combined);

			// Find images
			let chapterImages = [];
			if (chapterId != "-1") {
				// Scrape page to find images
				const chapter = allChapters.find((c) => c.id === chapterId);

				if (chapter) {
					const atHome = await getDataFromURL(
						`https://api.mangadex.org/at-home/server/${chapter.id}`
					);
					const { baseUrl } = atHome;
					chapterImages = chapter.attributes.data.map(
						(id) => `${baseUrl}/data/${chapter.attributes.hash}/${id}`
					);
				} else {
					console.error(
						chalk.red("[Mangadex]") +
							` A MangaDex chapter was requested but chapter was not found`
					);
				}
			}

			// Find description
			const descriptionParagraphs = data.attributes.description.en
				.split("[")[0]
				.replace(/\r/g, "")
				.split("\n")
				.filter(Boolean);

			// See if manga is NSFW
			const nsfw = data.attributes.contentRating !== "safe";

			// Return it.
			const providerId = getProviderId(this.provider);

			return {
				constant: {
					title,
					slug,
					posterUrl,
					alternateTitles,
					descriptionParagraphs,
					genres,
					nsfw,
				},
				data: {
					chapters,
					chapterImages,
					status,
				},
				success: true,
				provider: isProviderId(providerId) ? providerId : null,
			};
		} catch (err) {
			// OOPSIE WOOPSIE!! Uwu We made a fucky wucky!! A wittle fucko boingo! The code monkeys at our headquarters are working VEWY HAWD to fix this!
			console.error(err.stack);
			console.error(
				chalk.red("[Mangadex]") + ` Failed to fetch: ${slug}, ${chapterId}`
			);
			return error(-1, err);
		}
	}
}

async function getDataFromURL(url: string) {
	let retryCount = 0;
	let isValid = false;
	let data: any = {};

	while (!isValid && retryCount < 4) {
		// Get data
		const dataReq = await fetch(url);
		if (dataReq.status === 204) {
			// Empty result.
			// Just end the loop
			isValid = true;
			return data;
		} else {
			let res = (data = await dataReq.text());
			if (!res.startsWith("<") && res.trim().length > 0) {
				try {
					data = JSON.parse(data);
					isValid = true;
				} catch (e) {
					// Oh well
					retryCount++;
					await sleep(100 * Math.floor(Math.random() * 50));
				}
			} else {
				retryCount++;
				await sleep(100 * Math.floor(Math.random() * 50));
			}
		}
	}
	return data;
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Generate mangadex object and export it
const mangadex5 = new mangadexClass();
export default mangadex5;
