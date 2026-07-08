"""Trainer for TinyGPT model."""

import logging
from pathlib import Path
from typing import Optional, Tuple

import torch
import torch.nn as nn
import torch.optim as optim
from torch.cuda.amp import GradScaler, autocast
from torch.utils.data import DataLoader, Dataset

from config import ModelConfig, TrainingConfig
from model import GPT

logger = logging.getLogger(__name__)


class Trainer:
    """Trainer for GPT model."""

    def __init__(
        self,
        model: GPT,
        train_dataset: Dataset,
        val_dataset: Dataset,
        config: TrainingConfig,
    ):
        """Initialize trainer.

        Args:
            model: GPT model instance.
            train_dataset: Training dataset.
            val_dataset: Validation dataset.
            config: Training configuration.
        """
        self.model = model
        self.train_dataset = train_dataset
        self.val_dataset = val_dataset
        self.config = config
        self.device = torch.device(config.device)
        self.model.to(self.device)

        # Optimizer with weight decay
        self.optimizer = optim.AdamW(
            model.parameters(),
            lr=config.learning_rate,
            weight_decay=config.weight_decay,
        )

        # Learning rate scheduler (cosine annealing)
        self.scheduler = self._create_scheduler()

        # Mixed precision
        self.scaler = GradScaler(enabled=config.use_amp)
        self.use_amp = config.use_amp

        # Training state
        self.global_step = 0
        self.best_val_loss = float("inf")

    def _create_scheduler(self):
        """Create learning rate scheduler."""
        def lr_lambda(current_step: int) -> float:
            warmup_steps = self.config.warmup_steps
            total_steps = self.config.total_steps

            if current_step < warmup_steps:
                # Linear warmup
                return float(current_step) / float(max(1, warmup_steps))
            else:
                # Cosine annealing
                progress = float(current_step - warmup_steps) / float(
                    max(1, total_steps - warmup_steps)
                )
                return max(0.0, 0.5 * (1.0 + torch.cos(torch.tensor(3.14159 * progress)).item()))

        return optim.lr_scheduler.LambdaLR(self.optimizer, lr_lambda)

    def train_epoch(self) -> float:
        """Train for one epoch.

        Returns:
            Average training loss.
        """
        self.model.train()
        total_loss = 0.0
        num_batches = 0

        train_loader = DataLoader(
            self.train_dataset,
            batch_size=self.config.batch_size,
            shuffle=True,
            pin_memory=True,
        )

        for batch_idx, (input_ids, labels) in enumerate(train_loader):
            input_ids = input_ids.to(self.device)
            labels = labels.to(self.device)

            # Forward pass with AMP
            with autocast(enabled=self.use_amp):
                logits = self.model(input_ids)
                loss = nn.functional.cross_entropy(
                    logits.view(-1, logits.shape[-1]),
                    labels.view(-1),
                )
                loss = loss / self.config.gradient_accumulation_steps

            # Backward pass
            self.scaler.scale(loss).backward()

            # Gradient accumulation
            if (batch_idx + 1) % self.config.gradient_accumulation_steps == 0:
                self.scaler.unscale_(self.optimizer)
                torch.nn.utils.clip_grad_norm_(
                    self.model.parameters(), self.config.max_grad_norm
                )
                self.scaler.step(self.optimizer)
                self.scaler.update()
                self.optimizer.zero_grad()
                self.scheduler.step()
                self.global_step += 1

            total_loss += loss.item() * self.config.gradient_accumulation_steps
            num_batches += 1

            if (batch_idx + 1) % 100 == 0:
                logger.info(
                    f"Batch {batch_idx + 1}/{len(train_loader)}, "
                    f"Loss: {loss.item() * self.config.gradient_accumulation_steps:.4f}"
                )

        return total_loss / num_batches

    @torch.no_grad()
    def evaluate(self, num_samples: Optional[int] = None) -> float:
        """Evaluate on validation set.

        Args:
            num_samples: Number of samples to evaluate on (None = all).

        Returns:
            Average validation loss.
        """
        self.model.eval()
        total_loss = 0.0
        num_batches = 0

        val_loader = DataLoader(
            self.val_dataset,
            batch_size=self.config.batch_size,
            shuffle=False,
            pin_memory=True,
        )

        for batch_idx, (input_ids, labels) in enumerate(val_loader):
            if num_samples and batch_idx * self.config.batch_size >= num_samples:
                break

            input_ids = input_ids.to(self.device)
            labels = labels.to(self.device)

            with autocast(enabled=self.use_amp):
                logits = self.model(input_ids)
                loss = nn.functional.cross_entropy(
                    logits.view(-1, logits.shape[-1]),
                    labels.view(-1),
                )

            total_loss += loss.item()
            num_batches += 1

        return total_loss / num_batches

    def train(
        self,
        num_epochs: int,
        checkpoint_dir: Optional[Path] = None,
    ) -> Tuple[list, list]:
        """Train the model.

        Args:
            num_epochs: Number of training epochs.
            checkpoint_dir: Directory to save checkpoints.

        Returns:
            Tuple of (train_losses, val_losses).
        """
        checkpoint_dir = Path(checkpoint_dir or "checkpoints")
        checkpoint_dir.mkdir(exist_ok=True)

        train_losses = []
        val_losses = []

        for epoch in range(num_epochs):
            logger.info(f"\nEpoch {epoch + 1}/{num_epochs}")

            # Train
            train_loss = self.train_epoch()
            train_losses.append(train_loss)
            logger.info(f"Train Loss: {train_loss:.4f}")

            # Evaluate
            if self.global_step % self.config.eval_every == 0:
                val_loss = self.evaluate(num_samples=self.config.eval_samples)
                val_losses.append(val_loss)
                logger.info(f"Val Loss: {val_loss:.4f}")

                # Save checkpoint if best
                if val_loss < self.best_val_loss:
                    self.best_val_loss = val_loss
                    self.save_checkpoint(
                        checkpoint_dir / "best_model.pt", is_best=True
                    )

            # Save periodic checkpoint
            if self.global_step % self.config.save_every == 0:
                self.save_checkpoint(
                    checkpoint_dir / f"checkpoint_step_{self.global_step}.pt"
                )

        logger.info("Training complete!")
        return train_losses, val_losses

    def save_checkpoint(
        self, path: Path, is_best: bool = False
    ) -> None:
        """Save model checkpoint.

        Args:
            path: Path to save to.
            is_best: Whether this is the best checkpoint.
        """
        checkpoint = {
            "model_state_dict": self.model.state_dict(),
            "optimizer_state_dict": self.optimizer.state_dict(),
            "scheduler_state_dict": self.scheduler.state_dict(),
            "global_step": self.global_step,
            "config": self.model.config,
        }
        torch.save(checkpoint, path)
        logger.info(f"Saved checkpoint to {path}")

    def load_checkpoint(self, path: Path) -> None:
        """Load model checkpoint.

        Args:
            path: Path to load from.
        """
        checkpoint = torch.load(path, map_location=self.device)
        self.model.load_state_dict(checkpoint["model_state_dict"])
        self.optimizer.load_state_dict(checkpoint["optimizer_state_dict"])
        self.scheduler.load_state_dict(checkpoint["scheduler_state_dict"])
        self.global_step = checkpoint["global_step"]
        logger.info(f"Loaded checkpoint from {path}")
