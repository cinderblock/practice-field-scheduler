import { TZDateMini } from "@date-fns/tz";
import styles from "../index.module.css";

const genericPhrases = [
	"No robots, no glory!",
	"Build, test, iterate",
	"Your robot's waiting...",
	"Time to make some magic!",
	"The field is calling",
	"Ready to make history?",
	"Your robot's best friend...",
	"Let's make it happen!",
	"Time to shine!",
	"The field is yours...",
	"Make it count!",
	"Your robot's waiting",
	"The field is calling",
	"Your moment to shine!",
	"Your robot's best friend",
	"The field is your canvas...",
	"Your robot's playground",
	"The field is your oyster",
	"You could be alone...",
	"Have the field to yourself?",
	"No distractions here...",
	"Your robot's happy place",
	"Show me what you got!",
	"Get Schwifty!", // cSpell:ignore Schwifty
	"May the Mass•Acceleration be with you!",
	"To infinity and beyond!",
	"Winter is coming...",
	"You're a robot, Harry!",
	"Just keep coding!",
	"Why so mechanical?",
	"Here's looking at you, bot.",
	"Elementary, my dear robot.",
	"I'll be back... with upgrades!",
	"Straight outta East Palo Alto!", // cSpell:ignore Palo
	"Keep calm and code on.",
	"With great power comes great... robots!",
	"Avengers, assemble your robots!",
	"Expecto Robotum!", // cSpell:ignore Expecto Robotum
	"Eat, sleep, robot, repeat.",
	"Can't stop the feeling... of victory!",
	"Do or do not, there is no try... with robots!",
	"Adventure awaits...",
	"Unleash your robot's potential!",
	"Time to write your robot's story.",
	"Beam me up, robot!",
	"Resistance is futile... to robot awesomeness!",
	"May the odds be ever in your robot's favor!",
	"Game of Robots!",
	"Robot, I am your father!",
];

// Humorous phrases for empty states
const emptyDayPhrases = [
	"Seize the day!",
	"It's a good day for Robots",
	"Today's the day to shine!",
	"A whole day to yourself?",
	"Make today legendary!",
	"Today is your canvas.",
	...genericPhrases,
];

const emptySlotPhrases = [
	"Time to level up!",
	"Perfect timing...",
	"Time to make magic!",
	"Time to show your skills...",
	"Perfect practice time",
	"Every second counts!",
	"Time to break records!",
	"Your moment is now!",
	"Seize the slot!",
	"Time to shine bright!",
	"Make this slot legendary!",
	...genericPhrases,
];

const fixedPhrases: {
	matcher: RegExp | string | ((input: string) => boolean);
	phrase: string | ((input: string) => string);
}[] = [
	{
		matcher: /^\d{4}-03-14$/,
		phrase: "Pie Day!",
	},
	{
		matcher: /^\d{4}-03-14 1pm$/, // TODO: Programatically pick the slot that contains 3:14
		phrase: "Pie Time!",
	},
	{
		matcher: date => {
			// Only match full days
			if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;

			const d = new TZDateMini(date);
			// if Wednesday, run deteministic decider and have a 10% chance to return true
			return d.getDay() === 2 && !getDeterministicRandomBelow(date, 10);
		},
		phrase: "On Wednesdays, robots wear pink.",
	},
];

function getDeterministicRandomBelow(seed: string, max: number): number {
	// Create a predictable hash using seed string
	let hash = 0;
	for (let i = 0; i < seed.length; i++) {
		const char = seed.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash; // Convert to 32-bit integer
	}
	return Math.abs(hash) % max;
}

// Deterministically select a phrase based on date and slot
function getEmptyPhrase(date: string, slot?: string): string {
	const input = `${date}${slot === undefined ? "" : ` ${slot}`}`;

	for (const { matcher, phrase } of fixedPhrases) {
		if (
			typeof matcher === "string"
				? input === matcher
				: typeof matcher === "function"
					? matcher(input)
					: matcher.test(input)
		) {
			return typeof phrase === "string" ? phrase : phrase(input);
		}
	}

	// Select a different set of phrases based on whether the slot is defined
	const phrases = slot ? emptySlotPhrases : emptyDayPhrases;

	const res = phrases[getDeterministicRandomBelow(input, phrases.length)];

	// Should not happen
	if (!res) throw new Error("getEmptyPhrase: specificHash is out of bounds");

	return res;
}

export function EmptyPlaceholder({ date, slot, style }: { date: string; slot?: string; style?: React.CSSProperties }) {
	return <div className={styles.emptyDayMessage}>{getEmptyPhrase(date, slot)}</div>;
}
