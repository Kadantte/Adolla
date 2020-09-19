// This JS file is only for the reader.
// If this is run, it's fair to assume
// that this is the reader page

// Load state
let loaded = false;

document.querySelector(".manga-reader .loading").scrollIntoView({
	inline: "start",
	block: "start"
});

// This is a debounce effect for the page update
let scrollDebounce;
function updateScrollDebounce() {
	if(scrollDebounce) {
		clearTimeout(scrollDebounce);
		delete scrollDebounce;
	}
	scrollDebounce = setTimeout(() => {
		if(!loaded) return;
		// Send POST request to update "reading" state
		let [currentPage, pageCount] = getPageProgress();

		let pathname = location.pathname;
		if(!pathname.endsWith("/")) pathname += "/";
		
		fetch(pathname + "set-progress", {
			method: "POST",
			headers: {
				"content-type": "application/json"
			},
			body: JSON.stringify({
				current: currentPage,
				total: pageCount
			})
		});
	}, 500);
}

// Find html and pages so that we can add scroll listeners for both
document.addEventListener("scroll", updateScrollDebounce);
document.querySelector(".pages").addEventListener("scroll", updateScrollDebounce);
setInterval(updatePages, 500);


function updatePages() {
	
	let [currentPage, pageCount] = getPageProgress();

	if(loaded) document.body.setAttribute("data-to-page", currentPage);

	document.querySelectorAll(".current-page").forEach(span => {
		span.innerText = `${currentPage} of ${pageCount}`;
	});
}
updatePages();

// Get page progress
function getPageProgress() {
	let pageCount = document.querySelectorAll(".pageImg").length;

	// Check if the reader is horizontal or not
	let isHorizontal = readerIsHorizontal();
	
	// Get offset for pages
	let direction = isHorizontal ? "left" : "bottom";
	let wrapperOffset = isHorizontal ? document.querySelector(".pages").getBoundingClientRect()[direction] : window.innerHeight;
	let elementOffsets = [...document.querySelectorAll(".pageImg")].map(d => ({
		offset: Math.abs(d.getBoundingClientRect()[direction] - wrapperOffset),
		el: d
	})).sort((a, b) => a.offset - b.offset);
	
	let closestPage = elementOffsets[0]?.el;
	
	let currentPage = closestPage ? [...document.querySelectorAll(".pageImg")].indexOf(closestPage) + 1 : 1;
	return [currentPage, pageCount];
}

function readerIsHorizontal() {
	// Returns if the images are vertical or not
	let leftPositions = [...document.querySelectorAll(".pageImg")].map(d => d.getBoundingClientRect().left);
	return [...new Set(leftPositions)].length !== 1;
}

// Scroll to page
function scrollToPage() {
	let page = Number(document.body.dataset.toPage) || 1;
	console.info("Scroll to page", page);
	if(page) {
		// Get relevant element and scroll to it
		let pageEl = document.querySelectorAll(".pageImg")[page - 1];
		if(!pageEl) return null;
		scrollReader(pageEl);
	}
}
function scrollReader(pageEl) {
	let topOffset = Number(window.getComputedStyle(document.body, ":before").height.slice(0, -2));
	
	pageEl.scrollIntoView({
		inline: "start",
		block: "start"
	});
	if(!readerIsHorizontal()) {
		window.scrollBy(0, -topOffset);
		// Deal with iOS padding
	}
}

window.addEventListener("load", () => {
	loaded = true;
	document.querySelector(".manga-reader").classList.add("loaded");
	setTimeout(() => {
		scrollToPage();
	}, 100);
});

// Add click event to floating button
document.querySelectorAll(".floating-button").forEach(button => {
	button.addEventListener("click", () => {
		button.classList.add("clicked", "badge-background");
	});
});

// Keyboard controls
document.addEventListener("keydown", evt => {
	if(!evt.key.startsWith("Arrow")) return;
	evt.preventDefault();

	let isHorizontal = readerIsHorizontal();

	function nextPage() {
		let [currentPage, pageCount] = getPageProgress();
		let pageEl = document.querySelectorAll(".pageImg")[currentPage];
		if(pageEl) scrollReader(pageEl);
	}
	function previousPage() {
		let [currentPage, pageCount] = getPageProgress();
		let pageEl = document.querySelectorAll(".pageImg")[currentPage - 2];
		if(pageEl) scrollReader(pageEl);
	}
	function nextChapter() {
		document.querySelector(".next .chapterLink").click()
	}
	function previousChapter() {
		document.querySelector(".previous .chapterLink").click()
	}

	switch(evt.key) {
		case "ArrowLeft":
			isHorizontal ? previousPage() : previousChapter();
			break;
		case "ArrowRight":
			isHorizontal ? nextPage() : nextChapter();
			break;
		case "ArrowUp":
			isHorizontal ? previousChapter() : previousPage();
			break;
		case "ArrowDown":
			isHorizontal ? nextChapter() : nextPage();
			break;
		default:
			alert("Unknown");
	}

});

// "Tap to toggle" elements
document.querySelector(".pages").addEventListener("click", evt => {
	
	// Get all classes for each element in the path
	let classes = [...evt.composedPath()].reverse().map(v => Object.values(v.classList ?? {}).join(".")).map(v => v.length > 0 ? "." + v : v).join(" ").trim();

	// If no button was pressed, toggle each relevant class
	if(!classes.includes(".secondary-button")) document.querySelectorAll(".toggle-on-tap").forEach(toggle => toggle.classList.toggle("tapped"));
});