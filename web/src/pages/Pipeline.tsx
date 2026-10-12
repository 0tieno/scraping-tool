import { useState } from "react";
import { api } from "../api";
import { Due, Empty, ScoreRing, useToast } from "../components/ui";
import { STATUS_LABELS } from "../format";
import { navigate, useAsync } from "../hooks";
import type { Opportunity, PipelineStatus } from "../types";

const LANES: PipelineStatus[] = ["shortlisted", "in_proposal", "submitted", "won", "lost"];

export function PipelinePage() {
  const toast = useToast();
  const board = useAsync(() => api.list({ status: LANES, includeExpired: true, sort: "deadline", limit: 500 }), []);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<PipelineStatus | null>(null);
  const [optimistic, setOptimistic] = useState<Record<string, PipelineStatus>>({});

  const items = (board.data?.items ?? []).map((o) => (optimistic[o.id] ? { ...o, status: optimistic[o.id]! } : o));

  const move = async (id: string, status: PipelineStatus) => {
    const current = items.find((o) => o.id === id);
    if (!current || current.status === status) return;
    setOptimistic((m) => ({ ...m, [id]: status }));
    try {
      await api.update(id, { status });
      toast(`Moved to ${STATUS_LABELS[status]}`);
    } catch (e) {
      setOptimistic((m) => {
        const { [id]: _removed, ...rest } = m;
        return rest;
      });
      toast(`Move failed: ${(e as Error).message}`);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Bid pipeline</h1>
          <div className="page-sub">Drag cards between stages. Shortlist opportunities from the radar to add them here.</div>
        </div>
      </div>
      {board.error && <div className="alert">{board.error.message}</div>}
      {board.data && !board.data.items.length ? (
        <div className="card">
          <Empty title="Your pipeline is empty">
            Open an opportunity on the <a href="#/">radar</a> and choose <b>Shortlist</b> to start tracking a bid.
          </Empty>
        </div>
      ) : (
        <div className="board">
          {LANES.map((lane) => {
            const laneItems = items.filter((o) => o.status === lane);
            return (
              <section
                key={lane}
                className={`lane${over === lane ? " drop" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(lane);
                }}
                onDragLeave={() => setOver((cur) => (cur === lane ? null : cur))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(null);
                  const id = e.dataTransfer.getData("text/plain") || dragging;
                  if (id) void move(id, lane);
                }}
                aria-label={STATUS_LABELS[lane]}
              >
                <div className="lane-head">
                  <span>{STATUS_LABELS[lane]}</span>
                  <span className="pill">{laneItems.length}</span>
                </div>
                <div className="lane-body">
                  {laneItems.map((o) => (
                    <Tile key={o.id} o={o} onDragStart={() => setDragging(o.id)} onDragEnd={() => setDragging(null)} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function Tile({ o, onDragStart, onDragEnd }: { o: Opportunity; onDragStart: () => void; onDragEnd: () => void }) {
  return (
    <article
      className="tile"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", o.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={() => navigate(`/opportunity/${o.id}`)}
      onKeyDown={(e) => e.key === "Enter" && navigate(`/opportunity/${o.id}`)}
      tabIndex={0}
    >
      <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
        <div className="tile-title" style={{ flex: 1 }}>
          {o.title}
        </div>
        <div style={{ transform: "scale(.78)", transformOrigin: "top right" }}>
          <ScoreRing score={o.score} tier={o.tier} />
        </div>
      </div>
      <div className="muted small">{o.buyer ?? o.source}</div>
      <div className="row small">
        <Due deadline={o.deadline} />
        <span className="spacer" />
        {o.owner && <span className="chip neutral">{o.owner}</span>}
      </div>
    </article>
  );
}
