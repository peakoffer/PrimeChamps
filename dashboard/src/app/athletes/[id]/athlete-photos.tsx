"use client";

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { sortInstagramPostsNewestFirst } from "@/lib/instagram-post-order";
import { formatDate } from "@/lib/utils";

interface Photo {
  id: string;
  url: string;
  displayUrl: string;
  caption?: string;
  timestamp?: string | null;
}

interface PhotoStats {
  new: number;
  updated: number;
  total: number;
}

export function AthletePhotos({
  athleteId,
  handle,
  reloadKey,
  onNotice,
}: {
  athleteId: string;
  handle: string | null;
  /** Bump to re-read stored photos (e.g. after a data refresh). */
  reloadKey: number;
  onNotice: (text: string) => void;
}) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/instagram/photos?athleteId=${athleteId}`)
      .then((response) => response.json())
      .then((data: { photos?: Photo[] }) => {
        if (data.photos?.length) setPhotos(sortInstagramPostsNewestFirst(data.photos));
      })
      .catch((error) => console.error("Error loading photos:", error));
  }, [athleteId, reloadKey]);

  // Scrapes fresh posts from Instagram via the photos endpoint.
  const loadPhotos = async () => {
    setLoading(true);
    setStatus("Fetching from Instagram…");
    try {
      const response = await fetch("/api/instagram/photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ athleteId, limit: 10 }),
      });
      const data = (await response.json()) as { photos?: Photo[]; stats?: PhotoStats; error?: string; message?: string };
      if (!response.ok) {
        setStatus(data.error || "Failed to fetch photos");
        return;
      }
      if (data.photos?.length) {
        setPhotos(sortInstagramPostsNewestFirst(data.photos));
        setStatus(null);
        if (data.stats) {
          onNotice(data.stats.new > 0
            ? `Loaded ${data.stats.new} new photo${data.stats.new > 1 ? "s" : ""}`
            : `All ${data.stats.total} photos are current`);
        }
      } else {
        setStatus(data.message || "No photos available");
      }
    } catch (error) {
      console.error("Error fetching Instagram photos:", error);
      setStatus("Failed to load photos");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section aria-labelledby="photos-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="photos-heading" className="pc-section-heading">Photos</h2>
        {handle && photos.length === 0 && (
          <button type="button" onClick={() => void loadPhotos()} disabled={loading} className="pc-button-secondary">
            {loading && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
            Load photos
          </button>
        )}
      </div>
      {status && <p role="status" className="mt-1 text-sm text-brand-muted">{status}</p>}
      {photos.length > 0 ? (
        <div className="mt-3 grid grid-cols-4 gap-1.5 sm:gap-2">
          {photos.slice(0, 8).map((photo) => (
            <a
              key={photo.id}
              href={photo.url}
              target="_blank"
              rel="noopener noreferrer"
              title={photo.timestamp ? formatDate(photo.timestamp) : undefined}
              className="aspect-square overflow-hidden bg-brand-paper hover:outline hover:outline-2 hover:outline-brand-blue"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- Instagram CDN images */}
              <img src={photo.displayUrl} alt={photo.caption || "Instagram post"} className="h-full w-full object-cover" loading="lazy" />
            </a>
          ))}
        </div>
      ) : (
        !status && (
          <p className="mt-1 text-sm text-brand-muted">
            {handle ? "No photos loaded yet." : "Add an Instagram handle to see photos."}
          </p>
        )
      )}
    </section>
  );
}
