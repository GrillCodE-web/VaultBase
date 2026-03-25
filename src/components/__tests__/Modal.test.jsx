import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Modal } from '../Modal.jsx'

// Mock focus trap at module level
vi.mock('../hooks/useFocusTrap', () => ({
  useFocusTrap: vi.fn(),
}))

describe('Modal Component (Accessibility)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('ARIA attributes', () => {
    it('has role="dialog" and aria-modal="true"', () => {
      render(
        <Modal isOpen={true} onClose={vi.fn()} title="Test Modal">
          Content
        </Modal>
      )

      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-modal', 'true')
    })

    it('has aria-labelledby pointing to title', () => {
      render(
        <Modal isOpen={true} onClose={vi.fn()} title="Test Title">
          Content
        </Modal>
      )

      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-labelledby', 'modal-title')

      const title = screen.getByText('Test Title')
      expect(title).toHaveAttribute('id', 'modal-title')
    })

    it('close button has aria-label', () => {
      const onClose = vi.fn()
      render(
        <Modal isOpen={true} onClose={onClose} title="Test Modal">
          Content
        </Modal>
      )

      const closeButton = screen.getByLabelText('Close')
      expect(closeButton).toBeInTheDocument()
    })
  })

  describe('Interactive elements', () => {
    it('closes when clicking overlay', () => {
      const onClose = vi.fn()

      render(
        <Modal isOpen={true} onClose={onClose} title="Test Modal">
          Content
        </Modal>
      )

      // Click on overlay (outside modal content)
      fireEvent.click(screen.getByRole('dialog').parentElement)

      expect(onClose).toHaveBeenCalled()
    })

    it('does not close when clicking modal content', () => {
      const onClose = vi.fn()

      render(
        <Modal isOpen={true} onClose={onClose} title="Test Modal">
          <button>Inside Button</button>
        </Modal>
      )

      fireEvent.click(screen.getByText('Inside Button'))

      expect(onClose).not.toHaveBeenCalled()
    })

    it('does not render close button when showCloseButton is false', () => {
      const onClose = vi.fn()

      render(
        <Modal isOpen={true} onClose={onClose} title="Test Modal" showCloseButton={false}>
          Content
        </Modal>
      )

      expect(screen.queryByLabelText('Close')).not.toBeInTheDocument()
    })
  })

  describe('Footer', () => {
    it('renders footer when provided', () => {
      render(
        <Modal isOpen={true} onClose={vi.fn()} title="Test Modal" footer={<button>Save</button>}>
          Content
        </Modal>
      )

      expect(screen.getByText('Save')).toBeInTheDocument()
    })
  })

  describe('Size variants', () => {
    it('applies correct CSS variable for each size', () => {
      const sizes = {
        sm: 'var(--modal-sm)',
        md: 'var(--modal-md)',
        lg: 'var(--modal-lg)',
        xl: 'var(--modal-xl)',
      }

      Object.entries(sizes).forEach(([size, expectedVar]) => {
        const { container, unmount } = render(
          <Modal isOpen={true} onClose={vi.fn()} title="Test" size={size}>
            Content
          </Modal>
        )

        const modal = container.querySelector('[role="dialog"]')
        // Check that the CSS variable is set via custom property
        expect(modal.style.getPropertyValue('--modal-size')).toBe(expectedVar)
        unmount()
      })
    })
  })

  describe('Hidden when closed', () => {
    it('returns null when isOpen is false', () => {
      const { container } = render(
        <Modal isOpen={false} onClose={vi.fn()} title="Test Modal">
          Content
        </Modal>
      )

      expect(container.firstChild).toBeNull()
    })
  })

  describe('Keyboard interactions', () => {
    it('calls onClose when Escape is pressed', () => {
      const onClose = vi.fn()

      render(
        <Modal isOpen={true} onClose={onClose} title="Test Modal">
          Content
        </Modal>
      )

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(onClose).toHaveBeenCalled()
    })
  })
})
