"use client";

import { createContext, type ReactNode, useContext, useState } from "react";

interface HistoryContextType {
	isLoadingHistory: boolean;
	setIsLoadingHistory: (loading: boolean) => void;
	loadHistory: () => void;
	setLoadHistory: (fn: () => void) => void;
}

const HistoryContext = createContext<HistoryContextType | undefined>(undefined);

export function HistoryProvider({ children }: { children: ReactNode }) {
	const [isLoadingHistory, setIsLoadingHistory] = useState(false);
	const [loadHistoryFn, setLoadHistoryFn] = useState<(() => void) | null>(null);

	const loadHistory = () => {
		if (loadHistoryFn) {
			loadHistoryFn();
		}
	};

	return (
		<HistoryContext.Provider
			value={{
				isLoadingHistory,
				setIsLoadingHistory,
				loadHistory,
				setLoadHistory: setLoadHistoryFn,
			}}
		>
			{children}
		</HistoryContext.Provider>
	);
}

export function useHistory() {
	const context = useContext(HistoryContext);
	if (context === undefined) {
		throw new Error("useHistory must be used within a HistoryProvider");
	}
	return context;
}
