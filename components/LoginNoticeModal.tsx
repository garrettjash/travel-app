type LoginNoticeModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

const funnyLoginImage =
  "https://images.unsplash.com/photo-1546182990-dffeafbe841d?auto=format&fit=crop&w=900&q=80";

export default function LoginNoticeModal({ isOpen, onClose }: LoginNoticeModalProps) {
  if (!isOpen) return null;

  return (
    <div className="login-notice-overlay" role="dialog" aria-modal="true" aria-label="Login not required">
      <button type="button" className="login-notice-backdrop" onClick={onClose} aria-label="Close login notice" />
      <section className="login-notice-content">
        <button type="button" className="login-notice-close" onClick={onClose}>
          Close
        </button>
        <img src={funnyLoginImage} alt="Funny travel moment" className="login-notice-image" />
        <h2>No Login Needed Right Now</h2>
        <p>You can keep exploring without logging in. We will add login when it is useful.</p>
      </section>
    </div>
  );
}
