import { useEffect, useState } from 'react';
import './index.css';

const liveRooms = [
  { name: 'Sunset Lounge', members: '1.2k', vibe: 'DJ set • open mic' },
  { name: 'Night Market', members: '840', vibe: 'Late-night chats' },
  { name: 'Afterglow', members: '620', vibe: 'Casual hangout' },
];

const feedPosts = [
  { author: 'Mina', tag: 'New friend', text: 'Hosting a cozy rooftop room tonight. Come say hi if you want good music and soft lighting.' },
  { author: 'Theo', tag: 'Community', text: 'The best part of this app is how easy it feels to meet people who just get it.' },
];

const chatMessages = [
  { user: 'Kai', text: 'Anyone around for a low-key vibe?' },
  { user: 'Rae', text: 'I am here. Music is perfect tonight.' },
  { user: 'Jules', text: 'Joining in a minute ✨' },
];

function App() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [checkoutStatus, setCheckoutStatus] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkoutState = params.get('checkout');

    if (checkoutState === 'success') {
      setCheckoutStatus('Payment successful! Welcome to your premium access.');
    }

    if (checkoutState === 'cancelled') {
      setCheckoutStatus('Checkout was cancelled. No charge was made.');
    }
  }, []);

  async function handleCheckout() {
    setIsProcessing(true);
    setCheckoutStatus('');

    try {
      const response = await fetch('http://localhost:3002/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName: 'QueerPulse Premium',
          amount: 2000,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Checkout could not be started.');
      }

      if (data.url) {
        window.location.href = data.url;
        return;
      }

      throw new Error('No checkout URL was returned.');
    } catch (error) {
      setCheckoutStatus(error.message || 'Something went wrong.');
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">QueerPulse</p>
          <h1>Live, social, and welcoming.</h1>
        </div>
        <div className="topbar-actions">
          <button className="secondary-btn" type="button">Start</button>
          <button className="primary-btn" type="button" onClick={handleCheckout} disabled={isProcessing}>
            {isProcessing ? 'Loading...' : 'Premium $20'}
          </button>
        </div>
      </header>

      {checkoutStatus ? <p className="checkout-status">{checkoutStatus}</p> : null}

      <main className="dashboard">
        <section className="hero-card">
          <div className="hero-copy">
            <p className="pill">Now live</p>
            <h2>Find your people in real time.</h2>
            <p>This is a place where the lbtq+ community can come together and share our love, devotion, and connect to find our happiness.</p>
            <p>A vibrant social app concept for queer nightlife, everyday chats, and spontaneous connection.</p>
          </div>
          <div className="stats-grid">
            <div><strong>24k+</strong><span>members</span></div>
            <div><strong>180</strong><span>rooms</span></div>
            <div><strong>92%</strong><span>good vibes</span></div>
          </div>
        </section>

        <section className="rooms-card">
          <div className="card-title-row">
            <h3>Popular rooms</h3>
            <a href="#">See all</a>
          </div>
          <div className="room-list">
            {liveRooms.map((room) => (
              <div className="room-item" key={room.name}>
                <div>
                  <strong>{room.name}</strong>
                  <p>{room.vibe}</p>
                </div>
                <span>{room.members} live</span>
              </div>
            ))}
          </div>
        </section>

        <section className="chat-card">
          <div className="card-title-row">
            <h3>Live chat</h3>
            <span className="online-dot">● online</span>
          </div>
          <div className="message-list">
            {chatMessages.map((message) => (
              <div className="message-bubble" key={message.user + message.text}>
                <strong>{message.user}</strong>
                <p>{message.text}</p>
              </div>
            ))}
          </div>
          <div className="chat-input">
            <input type="text" placeholder="Say something lovely..." />
            <button>Send</button>
          </div>
        </section>

        <section className="feed-card">
          <div className="card-title-row">
            <h3>Community feed</h3>
            <a href="#">Refresh</a>
          </div>
          <div className="feed-list">
            {feedPosts.map((post) => (
              <article className="feed-item" key={post.author}>
                <div className="feed-meta">
                  <strong>{post.author}</strong>
                  <span>{post.tag}</span>
                </div>
                <p>{post.text}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
