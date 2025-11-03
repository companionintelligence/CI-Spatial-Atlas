"use client";
import WorldExplorer from "../components/WorldExplorer";

export default function Home() {
  return (
    <main className="w-screen h-screen">
      <WorldExplorer enableTerrain enable3DTiles />
    </main>
  );
}
