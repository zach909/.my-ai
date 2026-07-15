"""Adaptive expert routing with confidence feedback loop.

When the mesh's confidence drops during generation, the routing system can:
1. Switch to different experts (explore mode)
2. Tighten routing selection (high-confidence experts only)
3. Rebalance expert weights based on output quality

This closes the loop between live guidance (monitoring confidence) and
expert selection (routing decisions).
"""
from __future__ import annotations

import torch
import torch.nn as nn
from typing import Optional
from dataclasses import dataclass


@dataclass
class RoutingDecision:
    """Result of adaptive routing."""
    action: str  # "switch", "tighten", "explore", "none"
    new_top_k: Optional[int] = None
    temperature_adjust: float = 1.0  # multiplier on expert selection temperature
    reason: str = ""


class AdaptiveExpertRouter:
    """Routes expert selection based on generation confidence.

    When confidence drops, adaptively:
    - Increase top_k to explore more experts (diversify)
    - Tighten routing to high-confidence experts only
    - Adjust routing temperature for sharper/softer decisions
    - Switch to different expert mix if current isn't working
    """

    def __init__(self, n_experts: int, base_top_k: int = 2,
                 confidence_threshold: float = 0.3, patience: int = 5):
        self.n_experts = n_experts
        self.base_top_k = base_top_k
        self.confidence_threshold = confidence_threshold
        self.patience = patience  # consecutive low-confidence before action

        # State tracking
        self.low_confidence_ticks = 0
        self.confidence_history = []
        self.last_routing = None
        self.expert_performance = torch.ones(n_experts)  # score each expert by output quality
        self.routing_history = []

    def update_confidence(self, confidence: float) -> None:
        """Update confidence estimate from model output (e.g., max logit softmax)."""
        self.confidence_history.append(confidence)
        if confidence < self.confidence_threshold:
            self.low_confidence_ticks += 1
        else:
            self.low_confidence_ticks = 0

    def record_expert_contribution(self, expert_idx: int, output_quality: float) -> None:
        """Record how well an expert's output performed (0-1 scale).

        Output quality could be:
        - Loss on validation set
        - Human satisfaction score
        - Downstream task performance
        """
        # Exponential moving average
        self.expert_performance[expert_idx] = 0.9 * self.expert_performance[expert_idx] + \
                                              0.1 * output_quality

    def decide_routing(self, current_top_k: int, active_experts: torch.Tensor) -> RoutingDecision:
        """Make adaptive routing decision based on confidence trend.

        Args:
            current_top_k: current number of active experts
            active_experts: (n_experts,) binary mask of currently active experts

        Returns:
            RoutingDecision with action and parameters
        """
        if self.low_confidence_ticks < self.patience:
            return RoutingDecision("none", reason="confidence adequate")

        # Confidence is low and sustained; decide on action
        current_avg_confidence = sum(self.confidence_history[-self.patience:]) / self.patience

        # Action 1: Switch to high-performing experts
        best_experts = torch.argsort(self.expert_performance, descending=True)[:current_top_k]
        if not torch.all(active_experts[best_experts]):
            return RoutingDecision(
                "switch",
                reason=f"confidence={current_avg_confidence:.3f}, switching to top performers"
            )

        # Action 2: Explore more experts (increase top_k)
        if current_top_k < self.n_experts // 2:
            new_top_k = min(current_top_k + 1, self.n_experts)
            return RoutingDecision(
                "explore",
                new_top_k=new_top_k,
                reason=f"confidence={current_avg_confidence:.3f}, exploring {new_top_k} experts"
            )

        # Action 3: Tighten routing (decrease top_k, sharper selection)
        if current_top_k > 1:
            return RoutingDecision(
                "tighten",
                new_top_k=max(1, current_top_k - 1),
                temperature_adjust=0.5,  # sharper routing softmax
                reason=f"confidence={current_avg_confidence:.3f}, tightening to top {current_top_k - 1}"
            )

        return RoutingDecision("none", reason="unable to improve routing")

    def apply_routing_decision(self, decision: RoutingDecision,
                             routing_scores: torch.Tensor) -> torch.Tensor:
        """Apply routing decision to modify routing scores.

        Args:
            decision: RoutingDecision from decide_routing()
            routing_scores: (n_experts,) scores from router network

        Returns:
            modified routing_scores
        """
        if decision.action == "none":
            return routing_scores

        scores = routing_scores.clone()

        if decision.action == "tighten":
            # Sharpen: raise scores to a higher power (steepens softmax)
            scores = torch.pow(torch.clamp(scores, 1e-6, 1), 1 / decision.temperature_adjust)

        elif decision.action == "explore":
            # Flatten: lower power (softer, more equal softmax)
            scores = torch.pow(torch.clamp(scores, 1e-6, 1), decision.temperature_adjust)

        elif decision.action == "switch":
            # Boost high-performers, suppress others
            boosted = scores * self.expert_performance.clamp(1e-6, 1)
            scores = boosted / (boosted.sum() + 1e-9)

        return scores


class ConfidenceAwareMixture(nn.Module):
    """Expert mixture that adapts based on output confidence.

    Combines adaptive routing with expert MoE so that low confidence
    automatically triggers expert switching or diversification.
    """

    def __init__(self, expert_moe: object, adaptive_router: AdaptiveExpertRouter):
        super().__init__()
        self.expert_moe = expert_moe
        self.router = adaptive_router
        self.current_top_k = expert_moe.top_k
        self.step = 0

    def forward(self, emb: torch.Tensor, confidence: Optional[float] = None) -> tuple:
        """Forward pass with optional confidence feedback.

        Args:
            emb: input embedding
            confidence: current generation confidence (0-1). If None, routing is static.

        Returns:
            (expert_output, gates, routing_decision)
        """
        # Get base routing
        output, gates = self.expert_moe(emb)

        # Adaptive routing based on confidence
        decision = RoutingDecision("none")
        if confidence is not None:
            self.router.update_confidence(confidence)
            active_mask = (gates > 0.1).any(dim=0).float()  # which experts are active
            decision = self.router.decide_routing(self.current_top_k, active_mask)

            # If we need to change routing, would require re-running with modified scores
            # (this is simplified; full version modifies expert_moe.gate)
            if decision.action != "none" and confidence is not None:
                # Would adjust top_k and re-route here
                self.current_top_k = decision.new_top_k or self.current_top_k

        self.step += 1
        return output, gates, decision

    def report_output_quality(self, expert_idx: int, quality: float) -> None:
        """Feedback: report how well this expert's output performed."""
        self.router.record_expert_contribution(expert_idx, quality)


class LiveGuidanceWithAdaptiveRouting:
    """Integration of live guidance with adaptive expert routing.

    During generation:
    1. Compute confidence from model output
    2. LiveGuide adjusts sampling temperature
    3. AdaptiveRouter adjusts expert selection
    4. Both feedback loops reinforce stable, confident generation
    """

    def __init__(self, base_temperature: float = 0.8, base_top_k: int = 40,
                 expert_moe: Optional[object] = None,
                 adaptive_router: Optional[AdaptiveExpertRouter] = None):
        from tinygpt.live_guide import LiveGuide

        self.live_guide = LiveGuide(
            base_temperature=base_temperature,
            base_top_k=base_top_k,
            base_top_p=0.95,
            low_confidence=0.25,
            patience=3
        )
        self.adaptive_routing = None
        if expert_moe and adaptive_router:
            self.adaptive_routing = ConfidenceAwareMixture(expert_moe, adaptive_router)

    def adjust_generation(self, logits: torch.Tensor, confidence: Optional[float] = None) -> dict:
        """Get generation adjustments from both live guidance and adaptive routing.

        Returns dict with:
        - temperature: adjusted temperature
        - top_k, top_p: sampling parameters
        - expert_action: routing decision (if using experts)
        - confidence: the input confidence
        """
        # Live guidance adjustments
        guidance_params = self.live_guide.adjust(confidence or 0.5)

        result = {
            "temperature": guidance_params.temperature,
            "top_k": guidance_params.top_k,
            "top_p": guidance_params.top_p,
            "confidence": confidence,
            "expert_action": None,
        }

        # Adaptive expert routing (if enabled)
        if self.adaptive_routing and confidence is not None:
            # Would integrate routing decision here
            decision = self.adaptive_routing.router.decide_routing(
                self.adaptive_routing.current_top_k,
                torch.ones(self.adaptive_routing.expert_moe.expert_moe.n_experts)
            )
            result["expert_action"] = decision

        return result

    def report_step_quality(self, next_token_prob: float, expert_idx: Optional[int] = None,
                           quality: Optional[float] = None) -> None:
        """Feedback: report generation quality to both systems."""
        if self.adaptive_routing and expert_idx is not None and quality is not None:
            self.adaptive_routing.report_output_quality(expert_idx, quality)
