"""Training script for TinyGPT."""

import argparse
import logging
from pathlib import Path

import torch
from torch.utils.data import DataLoader

from config import ModelConfig, TokenizerConfig, TrainingConfig
from dataset import create_train_val_split, ChatDataset
from model import GPT
from tokenizer import Tokenizer
from trainer import Trainer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def main():
    """Main training entry point."""
    parser = argparse.ArgumentParser(description="Train TinyGPT")
    parser.add_argument(
        "--mode",
        type=str,
        choices=["pretrain", "finetune"],
        default="pretrain",
        help="Training mode",
    )
    parser.add_argument(
        "--data-dir",
        type=str,
        required=True,
        help="Directory containing training data",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="./output",
        help="Output directory for checkpoints",
    )
    parser.add_argument(
        "--epochs",
        type=int,
        default=3,
        help="Number of training epochs",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=32,
        help="Batch size",
    )
    parser.add_argument(
        "--device",
        type=str,
        default="cuda",
        choices=["cuda", "cpu"],
        help="Device to use",
    )
    parser.add_argument(
        "--resume-from",
        type=str,
        default=None,
        help="Resume from checkpoint",
    )

    args = parser.parse_args()

    # Create output directories
    output_dir = Path(args.output_dir)
    checkpoint_dir = output_dir / "checkpoints"
    tokenizer_dir = output_dir / "tokenizer"
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    tokenizer_dir.mkdir(parents=True, exist_ok=True)

    # Set random seed
    torch.manual_seed(42)

    # Prepare data
    data_dir = Path(args.data_dir)
    logger.info(f"Loading data from {data_dir}")

    if args.mode == "pretrain":
        # Collect markdown files
        md_files = list(data_dir.glob("*.md")) + list(data_dir.glob("**/*.md"))
        if not md_files:
            logger.error(f"No .md files found in {data_dir}")
            return

        logger.info(f"Found {len(md_files)} markdown files")

        # Train or load tokenizer
        tokenizer_path = tokenizer_dir / "sp.model"
        if tokenizer_path.exists():
            logger.info("Loading existing tokenizer")
            tokenizer = Tokenizer.from_checkpoint(tokenizer_dir)
        else:
            logger.info("Training tokenizer")
            # Read all texts for tokenizer training
            texts = []
            for md_file in md_files:
                with open(md_file, "r", encoding="utf-8") as f:
                    texts.append(f.read())

            tokenizer = Tokenizer.train(
                texts,
                output_dir=tokenizer_dir,
                config=TokenizerConfig(),
            )
            logger.info(f"Tokenizer vocab size: {tokenizer.vocab_size}")

        # Create datasets
        logger.info("Creating datasets")
        train_dataset, val_dataset = create_train_val_split(
            md_files,
            tokenizer,
            val_split=0.1,
            context_length=ModelConfig().context_length,
        )

    else:  # finetune
        # Load tokenizer
        tokenizer_path = tokenizer_dir / "sp.model"
        if not tokenizer_path.exists():
            logger.error("Tokenizer not found. Run pretraining first.")
            return
        tokenizer = Tokenizer.from_checkpoint(tokenizer_dir)

        # Load chat data
        chat_file = data_dir / "chat.json"
        if not chat_file.exists():
            logger.error(f"Chat file not found: {chat_file}")
            return

        logger.info("Creating chat datasets")
        train_dataset = ChatDataset(chat_file, tokenizer)
        val_dataset = ChatDataset(chat_file, tokenizer)  # In practice, use separate data

    # Create model
    model_config = ModelConfig(vocab_size=tokenizer.vocab_size)
    model = GPT(model_config)
    logger.info(
        f"Created model with {sum(p.numel() for p in model.parameters()):,} parameters"
    )

    # Create trainer
    training_config = TrainingConfig(
        batch_size=args.batch_size,
        device=args.device,
    )
    trainer = Trainer(
        model=model,
        train_dataset=train_dataset,
        val_dataset=val_dataset,
        config=training_config,
    )

    # Resume from checkpoint if provided
    if args.resume_from:
        logger.info(f"Resuming from {args.resume_from}")
        trainer.load_checkpoint(Path(args.resume_from))

    # Train
    logger.info(f"Starting training for {args.epochs} epochs")
    train_losses, val_losses = trainer.train(
        num_epochs=args.epochs,
        checkpoint_dir=checkpoint_dir,
    )

    # Save final model
    final_model_path = output_dir / "final_model.pt"
    trainer.save_checkpoint(final_model_path)
    logger.info(f"Training complete! Final model saved to {final_model_path}")


if __name__ == "__main__":
    main()
