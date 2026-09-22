/* ============================================================
   Flashcards — StudentOS learn lane (SU-2, PRD-6).

   Make cards, filter by deck, and study one at a time: the
   question on the front, the answer behind a flip. Printing
   sends a real job to the school office printer — no phone.

   Doors: GET /student/flashcards?deck= · POST /student/flashcards
   · POST /student/print {kind:'flashcards'}.
   ============================================================ */
import { useEffect, useState } from 'react';
import { PageHead, Card, Button, Empty, ErrorState, SkeletonCard, Tabs, Modal, Progress, useToast } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { PrintButton } from '../../../components/student/PrintButton';
import { friendly } from '../../../lib/friendlyErrors';
import { getFlashcards, addFlashcard, type StudentFlashcard } from '../../../services/studentApi';

export default function Flashcards() {
  const toast = useToast();
  const [cards, setCards] = useState<StudentFlashcard[]>([]);
  const [decks, setDecks] = useState<string[]>([]);
  const [deck, setDeck] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const [newDeck, setNewDeck] = useState('');
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [subject, setSubject] = useState('');
  const [topic, setTopic] = useState('');
  const [saving, setSaving] = useState(false);

  const [study, setStudy] = useState(false);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getFlashcards(deck || undefined)
      .then(d => {
        if (!alive) return;
        setCards(d.cards);
        if (!deck) setDecks([...new Set(d.cards.map(c => c.deck))].sort());
      })
      .catch(e => { if (alive) setError(friendly(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [deck, tick]);

  useEffect(() => {
    if (!study) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { setIndex(i => Math.min(i + 1, cards.length - 1)); setFlipped(false); }
      else if (e.key === 'ArrowLeft') { setIndex(i => Math.max(i - 1, 0)); setFlipped(false); }
      else if (e.key === ' ') { e.preventDefault(); setFlipped(f => !f); }
      else if (e.key === 'Escape') setStudy(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [study, cards.length]);

  const canAdd = newDeck.trim() && front.trim() && back.trim();

  const add = async () => {
    if (!canAdd) return;
    setSaving(true);
    try {
      await addFlashcard({
        deck: newDeck.trim(),
        front: front.trim(),
        back: back.trim(),
        subject: subject.trim() || undefined,
        topic: topic.trim() || undefined,
      });
      setFront(''); setBack(''); setSubject(''); setTopic('');
      setDeck('');
      toast({ title: 'Card added', tone: 'success' });
      setTick(t => t + 1);
    } catch (e) {
      toast({ title: 'Could not add the card', sub: friendly(e), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const startStudy = () => {
    if (cards.length === 0) return;
    setIndex(0);
    setFlipped(false);
    setStudy(true);
  };

  const move = (delta: number) => {
    setIndex(i => Math.min(Math.max(i + delta, 0), cards.length - 1));
    setFlipped(false);
  };

  const current = cards[index];
  const deckTabs = [{ id: '', label: 'All decks' }, ...decks.map(d => ({ id: d, label: d }))];

  return (
    <div>
      <PageHead
        title="Flashcards"
        sub="Make a deck, then test yourself one card at a time. Print a deck for study away from the computer."
      />

      <Card headAs="h2" head="Add a card" sub="The deck name groups cards together.">
        <div className="grid grid-2" style={{ gap: '0 16px' }}>
          <div className="field">
            <label htmlFor="fc-deck">Deck</label>
            <input id="fc-deck" className="input" list="fc-deck-options" value={newDeck} placeholder="e.g. Science — plants" onChange={e => setNewDeck(e.target.value)} />
            <datalist id="fc-deck-options">
              {decks.map(d => <option key={d} value={d} />)}
            </datalist>
          </div>
          <div className="field">
            <label htmlFor="fc-subject">Subject (optional)</label>
            <input id="fc-subject" className="input" value={subject} placeholder="e.g. Science" onChange={e => setSubject(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="fc-front">Front — the question</label>
          <textarea id="fc-front" className="textarea" rows={2} value={front} placeholder="e.g. What do roots do?" onChange={e => setFront(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="fc-back">Back — the answer</label>
          <textarea id="fc-back" className="textarea" rows={2} value={back} placeholder="e.g. They take in water and hold the plant in the soil." onChange={e => setBack(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="fc-topic">Topic (optional)</label>
          <input id="fc-topic" className="input" value={topic} placeholder="e.g. Plant parts" onChange={e => setTopic(e.target.value)} />
        </div>
        <div className="u-flex" style={{ justifyContent: 'flex-end' }}>
          <Button variant="primary" icon={<Icon.Plus size={14} />} loading={saving} disabled={!canAdd} onClick={add}>Add card</Button>
        </div>
      </Card>

      <div style={{ marginTop: 18 }}>
        {decks.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <Tabs tabs={deckTabs} active={deck} onChange={id => { setDeck(id); setStudy(false); }} />
          </div>
        )}

        {loading && <SkeletonCard lines={5} />}

        {!loading && error && (
          <ErrorState title="Your flashcards did not load" sub={error} onRetry={() => setTick(t => t + 1)} />
        )}

        {!loading && !error && cards.length === 0 && (
          <Empty
            icon={<Icon.Layers size={22} />}
            title={deck ? 'No cards in this deck' : 'No flashcards yet'}
            sub={deck ? 'This deck has no cards. Add one above, or pick another deck.' : 'Add your first card above to start a deck.'}
          />
        )}

        {!loading && !error && cards.length > 0 && (
          <Card
            headAs="h2"
            head={deck || 'All decks'}
            sub={`${cards.length} card${cards.length === 1 ? '' : 's'}`}
            actions={
              <span className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
                <PrintButton
                  kind="flashcards"
                  label="Print flashcards"
                  payload={{ deck: deck || 'All decks', cards: cards.map(c => ({ front: c.front, back: c.back })) }}
                />
                <Button variant="primary" icon={<Icon.Play size={13} />} onClick={startStudy}>Study</Button>
              </span>
            }
          >
            <div className="u-col" style={{ gap: 8 }}>
              {cards.map(c => (
                <div key={c.id} className="u-flex" style={{ gap: 10, alignItems: 'flex-start', padding: '9px 2px', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span aria-hidden="true" style={{ color: 'var(--text-3)', marginTop: 1 }}><Icon.Layers size={15} /></span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 550 }}>{c.front}</div>
                    <div className="u-small u-muted" style={{ marginTop: 2 }}>{c.back}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      <Modal
        open={study}
        onClose={() => setStudy(false)}
        size="lg"
        title="Study"
        sub={`${deck || 'All decks'} · card ${Math.min(index + 1, cards.length)} of ${cards.length}`}
        footer={
          <div className="u-between" style={{ width: '100%', gap: 8 }}>
            <Button variant="secondary" size="sm" icon={<Icon.ChevronLeft size={13} />} disabled={index === 0} onClick={() => move(-1)}>Previous</Button>
            <Button variant="primary" size="sm" onClick={() => setFlipped(f => !f)}>{flipped ? 'Show question' : 'Show answer'}</Button>
            <Button variant="secondary" size="sm" iconRight={<Icon.ChevronRight size={13} />} disabled={index >= cards.length - 1} onClick={() => move(1)}>Next</Button>
          </div>
        }
      >
        {current && (
          <div className="u-col" style={{ gap: 12 }}>
            <Progress value={((index + 1) / cards.length) * 100} />
            <button
              type="button"
              onClick={() => setFlipped(f => !f)}
              aria-label={flipped ? 'Answer shown — activate to show the question' : 'Question shown — activate to show the answer'}
              style={{ minHeight: 190, width: '100%', textAlign: 'left', padding: '20px 18px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)', background: 'var(--surface-2)', cursor: 'pointer' }}
            >
              <div className="u-upper u-xs u-faint">{flipped ? 'Answer' : 'Question'}</div>
              <div style={{ fontSize: 'var(--text-xl)', fontWeight: 570, marginTop: 8 }}>{flipped ? current.back : current.front}</div>
            </button>
            <div className="u-xs u-faint">Space flips the card · arrow keys move between cards · Escape closes.</div>
          </div>
        )}
      </Modal>
    </div>
  );
}
