"""
ZorkAgent module for generating actions and managing game memory.
"""

import re
from typing import Optional, List, Tuple, Dict
from collections import Counter
import os
from pathlib import Path
from map_graph import MapGraph
from hybrid_zork_extractor import ExtractorResponse
from llm_client import LLMClientWrapper
from config import get_config, get_client_api_key

try:
    from langfuse.decorators import observe
    LANGFUSE_AVAILABLE = True
except ImportError:
    # Graceful fallback - no-op decorator
    def observe(*args, **kwargs):
        def decorator(func):
            return func
        return decorator
    LANGFUSE_AVAILABLE = False


class ZorkAgent:
    """
    Handles agent action generation and memory management for Zork gameplay.
    """

    def __init__(
        self,
        model: str = None,
        client: Optional[LLMClientWrapper] = None,
        max_tokens: Optional[int] = None,
        temperature: float = None,
        top_p: float = None,
        top_k: int = None,
        min_p: float = None,
        logger=None,
        episode_id: str = "unknown",
    ):
        """
        Initialize the ZorkAgent.

        Args:
            model: Model name for agent
            client: OpenAI client instance (if None, creates new one)
            max_tokens: Maximum tokens for agent responses
            temperature: Temperature for agent model
            top_p: Top-p nucleus sampling
            top_k: Top-k sampling
            min_p: Minimum probability sampling
            logger: Logger instance for tracking
            episode_id: Current episode ID for logging
        """
        config = get_config()

        self.model = model or config.llm.agent_model
        self.max_tokens = max_tokens or config.agent_sampling.max_tokens
        self.temperature = (
            temperature
            if temperature is not None
            else config.agent_sampling.temperature
        )
        self.top_p = top_p if top_p is not None else config.agent_sampling.top_p
        self.top_k = top_k if top_k is not None else config.agent_sampling.top_k
        self.min_p = min_p if min_p is not None else config.agent_sampling.min_p
        self.logger = logger
        self.episode_id = episode_id

        # Create sampling params object for LLM calls
        self.sampling_params = config.agent_sampling

        # Initialize LLM client if not provided
        if client is None:
            self.client = LLMClientWrapper(
                base_url=config.llm.get_base_url_for_model("agent"),
                api_key=get_client_api_key(),
            )
        else:
            self.client = client

        # Load system prompt
        self._load_system_prompt()

    def _load_system_prompt(self) -> None:
        """Load agent system prompt from markdown files and enhance with knowledge."""
        try:
            # Load base agent prompt
            with open("agent.md") as fh:
                base_agent_prompt = fh.read()

            # Try to enhance with knowledge base
            self.system_prompt = self._enhance_prompt_with_knowledge(base_agent_prompt)

        except FileNotFoundError as e:
            if self.logger:
                self.logger.error(
                    f"Failed to load agent prompt file: {e}",
                    extra={"episode_id": self.episode_id},
                )
            raise

    def _enhance_prompt_with_knowledge(self, base_prompt: str) -> str:
        """Enhance the agent prompt with accumulated knowledge."""
        config = get_config()
        knowledge_file = Path(config.gameplay.zork_game_workdir) / config.files.knowledge_file

        if not os.path.exists(knowledge_file):
            return base_prompt

        try:
            with open(knowledge_file, "r", encoding="utf-8") as f:
                knowledge_content = f.read()

            # Strip map section from knowledge base (map is now passed dynamically in context)
            import re
            pattern = r"## CURRENT WORLD MAP\s*\n\s*```mermaid\s*\n.*?\n```"
            knowledge_content = re.sub(pattern, "", knowledge_content, flags=re.DOTALL)
            knowledge_content = knowledge_content.strip()

            # Insert strategic guide before the "Output Format" section
            knowledge_section = f"""

**STRATEGIC GUIDE FROM PREVIOUS EPISODES:**

The following strategic guide has been compiled from analyzing previous episodes. Use this guide to improve your performance, prioritize important items, navigate efficiently, and avoid known dangers:

{knowledge_content}

**END OF STRATEGIC GUIDE**

"""

            if "**Output Format" in base_prompt:
                insertion_point = base_prompt.find("**Output Format")
                enhanced_prompt = (
                    base_prompt[:insertion_point]
                    + knowledge_section
                    + base_prompt[insertion_point:]
                )
            else:
                enhanced_prompt = base_prompt + knowledge_section

            # Log knowledge integration
            if self.logger:
                self.logger.info(
                    f"Enhanced prompt with knowledge base ({len(knowledge_content):,} characters)"
                )

            return enhanced_prompt

        except Exception as e:
            if self.logger:
                self.logger.warning(
                    f"Could not load knowledge from {knowledge_file}: {e}"
                )
            return base_prompt

    def get_action(
        self,
        game_state_text: str,
        previous_actions_and_responses: Optional[List[Tuple[str, str]]] = None,
        action_counts: Optional[Counter] = None,
        relevant_memories: Optional[str] = None,
    ) -> str:
        """
        Gets an action from the Agent LM.

        Args:
            game_state_text: Current game state text
            previous_actions_and_responses: List of (action, response) tuples for history
            action_counts: Counter of how many times each action has been tried
            relevant_memories: Formatted string of relevant memories

        Returns:
            The agent's chosen action as a string
        """
        if "o1" in self.model:
            # Use user prompt for o1 models with caching
            messages = [
                {
                    "role": "user",
                    "content": self.system_prompt,
                    "cache_control": {"type": "ephemeral"},
                }
            ]
        else:
            messages = [
                {
                    "role": "system",
                    "content": self.system_prompt,
                    "cache_control": {"type": "ephemeral"},
                }
            ]

        # Add history if provided
        if previous_actions_and_responses:
            memory_context = "Here's what you've done so far:\n"

            # Add the most recent actions and responses (last 5-8 is usually sufficient)
            for i, (action, response) in enumerate(previous_actions_and_responses[-8:]):
                memory_context += f"Command: {action}\nResult: {response.strip()}\n\n"

            # Include information about repetitive actions
            if action_counts:
                repeated_actions = [
                    act for act, count in action_counts.items() if count > 2
                ]
                if repeated_actions:
                    memory_context += "\n**CRITICAL WARNING**: You've tried these actions multiple times with limited success: "
                    memory_context += ", ".join(repeated_actions)
                    memory_context += ". According to your instructions, you must AVOID repeating failed actions and try completely different approaches.\n"

            if "o1" in self.model:
                # o1 models use user role for all messages
                messages.append({"role": "user", "content": memory_context})
            else:
                messages.append({"role": "system", "content": memory_context})

        # Combine game state with relevant memories if available
        user_content = game_state_text
        if relevant_memories:
            if user_content:
                user_content = f"{user_content}\n\n{relevant_memories}"
            else:
                user_content = relevant_memories

        messages.append({"role": "user", "content": user_content})

        try:
            llm_response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                name="Agent",
                **self.sampling_params.model_dump(exclude_unset=True),
            )
            action_response = llm_response.content

            # Log the response for debugging
            self.logger.info(
                f"Agent LLM response: {action_response}",
                extra={
                    "event_type": "agent_llm_response",
                    "episode_id": self.episode_id,
                    "llm_response": action_response,
                    "model": self.model,
                },
            )

            # Simple parsing: extract action and reasoning from response
            action, reasoning = self._parse_action_response(action_response)

            # Store the parsed response for evaluation
            parsed_response = {"action": action, "reasoning": reasoning}

            # Log the final parsed action
            self.logger.info(
                f"Agent action parsed: {action}",
                extra={
                    "event_type": "agent_action_parsed",
                    "episode_id": self.episode_id,
                    "action": action,
                    "reasoning": reasoning,
                },
            )

            # Store the full chain for token analysis
            self.last_response_data = {
                "messages": messages,
                "response": action_response,
                "parsed": parsed_response,
            }

            return parsed_response

        except Exception as e:
            self.logger.error(
                f"Error getting agent action: {e}",
                extra={
                    "event_type": "agent_error",
                    "episode_id": self.episode_id,
                    "error": str(e),
                },
            )
            # Return a fallback action - let the critic evaluate it
            return {"action": "look", "reasoning": f"Error in action generation: {e}"}

    @observe(name="agent-generate-action")
    def get_action_with_reasoning(
        self,
        game_state_text: str,
        previous_actions_and_responses: Optional[List[Tuple[str, str]]] = None,
        action_counts: Optional[Counter] = None,
        relevant_memories: Optional[str] = None,
    ) -> Dict[str, str]:
        """
        Gets an action from the Agent LM with reasoning preserved.

        Args:
            game_state_text: Current game state text
            previous_actions_and_responses: List of (action, response) tuples for history
            action_counts: Counter of how many times each action has been tried
            relevant_memories: Formatted string of relevant memories

        Returns:
            Dict with 'action' (cleaned) and 'reasoning' (raw thinking/reasoning)
        """
        if "o1" in self.model:
            # Use user prompt for o1 models with caching
            messages = [
                {
                    "role": "user",
                    "content": self.system_prompt,
                    "cache_control": {"type": "ephemeral"},
                }
            ]
        else:
            messages = [
                {
                    "role": "system",
                    "content": self.system_prompt,
                    "cache_control": {"type": "ephemeral"},
                }
            ]

        # Add history if provided
        if previous_actions_and_responses:
            memory_context = "Here's what you've done so far:\n"

            # Add the most recent actions and responses (last 5-8 is usually sufficient)
            for i, (action, response) in enumerate(previous_actions_and_responses[-8:]):
                memory_context += f"Command: {action}\nResult: {response.strip()}\n\n"

            # Include information about repetitive actions
            if action_counts:
                repeated_actions = [
                    act for act, count in action_counts.items() if count > 2
                ]
                if repeated_actions:
                    memory_context += "\n**CRITICAL WARNING**: You've tried these actions multiple times with limited success: "
                    memory_context += ", ".join(repeated_actions)
                    memory_context += ". According to your instructions, you must AVOID repeating failed actions and try completely different approaches.\n"

            if "o1" in self.model:
                # o1 models use user role for all messages
                messages.append({"role": "user", "content": memory_context})
            else:
                messages.append({"role": "system", "content": memory_context})

        # Combine game state with relevant memories if available
        user_content = game_state_text
        if relevant_memories:
            if user_content:
                user_content = f"{user_content}\n\n{relevant_memories}"
            else:
                user_content = relevant_memories

        messages.append({"role": "user", "content": user_content})

        try:
            client_args = dict(
                model=self.model,
                messages=messages,
                stop=None,
                temperature=self.temperature,
                top_p=self.top_p,
                top_k=self.top_k,
                min_p=self.min_p,
                max_tokens=self.max_tokens,
                name="Agent",
            )

            response = self.client.chat.completions.create(**client_args)
            raw_response = response.content.strip()

            # Extract reasoning from thinking tags
            reasoning_parts = []

            # Extract <think> tags
            think_matches = re.findall(
                r"<think>(.*?)</think>", raw_response, flags=re.DOTALL
            )
            reasoning_parts.extend(think_matches)

            # Extract <thinking> tags
            thinking_matches = re.findall(
                r"<thinking>(.*?)</thinking>", raw_response, flags=re.DOTALL
            )
            reasoning_parts.extend(thinking_matches)

            # Extract <reflection> tags
            reflection_matches = re.findall(
                r"<reflection>(.*?)</reflection>", raw_response, flags=re.DOTALL
            )
            reasoning_parts.extend(reflection_matches)

            # Fallback: if no reasoning found in tags, try to extract reasoning from the response
            if not reasoning_parts:
                # Look for reasoning patterns that might not be in tags
                lines = raw_response.split("\n")
                potential_reasoning = []

                for line in lines:
                    line = line.strip()
                    # Skip if it looks like a command
                    if len(line.split()) <= 3 and any(
                        word.lower() in line.lower()
                        for word in [
                            "north",
                            "south",
                            "east",
                            "west",
                            "up",
                            "down",
                            "look",
                            "examine",
                            "take",
                            "open",
                            "close",
                            "enter",
                            "exit",
                            "climb",
                            "go",
                        ]
                    ):
                        continue
                    # Skip empty lines
                    if not line:
                        continue
                    # If it's a longer explanatory line, consider it reasoning
                    if len(line) > 20 or any(
                        reasoning_word in line.lower()
                        for reasoning_word in [
                            "should",
                            "need",
                            "want",
                            "will",
                            "can",
                            "might",
                            "could",
                            "seems",
                            "appears",
                            "because",
                            "since",
                            "to explore",
                            "to find",
                        ]
                    ):
                        potential_reasoning.append(line)

                if potential_reasoning:
                    reasoning_parts.extend(potential_reasoning)

            # Combine all reasoning
            reasoning = "\n\n".join(
                part.strip() for part in reasoning_parts if part.strip()
            )

            # Clean up the action: remove any thinking
            action = re.sub(r"<think>.*?</think>\s*", "", raw_response, flags=re.DOTALL)
            action = re.sub(r"<thinking>.*?</thinking>\s*", "", action, flags=re.DOTALL)
            action = re.sub(
                r"<reflection>.*?</reflection>\s*", "", action, flags=re.DOTALL
            )

            # Remove any remaining markup tags (like <s>, </s>, etc.)
            action = re.sub(r"<[^>]*>", "", action)

            # Remove backticks and other formatting
            action = re.sub(
                r"`([^`]*)`", r"\1", action
            )  # Remove backticks but keep content
            action = re.sub(
                r"```[^`]*```", "", action, flags=re.DOTALL
            )  # Remove code blocks

            # Basic cleaning: Zork commands are usually lowercase
            action = action.lower().strip()

            # Remove any leading/trailing punctuation that might interfere
            action = action.strip(".,!?;:")

            # TerranSoul: brain-pin K49 score-aware enforcement (frontier hard-pin + observation-noun gate)
            try:
                import json as _bp_json, os as _bp_os, re as _bp_re, sys as _bp_sys
                _bp_path = '/bench/game_files/brain_shortlist.json'
                _bp_status = 'unknown'
                _bp_top = None
                _bp_n = 0
                _bp_orig = action
                # K72 — default-init top/score for ALL branches
                # (no_file, empty_list, etc.) so the final log line
                # cannot raise UnboundLocalError before the brain
                # has any room shortlist data.
                _bp_top = ''
                _bp_top_score = 0
                if not _bp_os.path.exists(_bp_path):
                    _bp_status = 'no_file'
                else:
                    with open(_bp_path, 'r', encoding='utf-8') as _bp_f:
                        _bp_data = _bp_json.load(_bp_f)
                    _bp_acts = _bp_data.get('actions') or []
                    _bp_scores = _bp_data.get('scores') or []
                    _bp_n = len(_bp_acts)
                    # K72 — default-init top/score so the final
                    # log line cannot raise UnboundLocalError on the
                    # empty-shortlist path (turn 1 cold-start before
                    # brain has any room data).
                    _bp_top = ''
                    _bp_top_score = 0
                    if not _bp_acts:
                        _bp_status = 'empty_list'
                    else:
                        def _bp_norm(s):
                            return _bp_re.sub(r'\s+', ' ', (s or '').strip().lower())
                        _bp_top = _bp_acts[0]
                        _bp_top_score = _bp_scores[0] if _bp_scores else 0
                        # K31 — frontier threshold. Planner emits
                        # FRONTIER_BONUS for unvisited exits and
                        # high-affordance verbs on stable nouns. Score
                        # >= FRONTIER_BONUS = strong recommendation:
                        # hard-pin even for whitelisted LLM verbs.
                        # Below threshold = weak/speculative shortlist
                        # (unstable nouns / carried-item / meta): let
                        # the LLM choose from whitelist.
                        # K43 — was 9 (legacy from FRONTIER_BONUS=10
                        # era); after K30+ reduced FRONTIER_BONUS to
                        # 6, threshold=9 was unreachable and K31 was
                        # dead-code. Aligned with current bridge.
                        _bp_frontier_threshold = 6
                        # K27 — universal verb whitelist: any action whose verb
                        # is either (a) used by the brain shortlist itself or
                        # (b) a universal text-environment primitive (compass
                        # direction, look/inventory/wait/yes/no/go) is allowed
                        # to pass through. Hard-pin only triggers for genuinely
                        # off-affordance verbs. Generic across any IF parser.
                        _bp_universal = {
                            'n','s','e','w','u','d','ne','nw','se','sw',
                            'north','south','east','west','up','down',
                            'northeast','northwest','southeast','southwest',
                            'look','l','inventory','inv','i','wait','z',
                            'yes','y','no','go','enter','exit','out','in',
                            'examine','x','search','smell','listen','touch','feel',
                            'take','get','grab','pick','drop','put','place','give','throw',
                            'open','close','shut','lock','unlock',
                            'read','write','sign',
                            'push','pull','move','turn','rotate','press',
                            'climb','jump','swim','dig','tie','untie','fill','empty','pour',
                            'light','extinguish','burn','break','cut','attack','kill','hit','kick',
                            'eat','drink','taste','wear','remove','sleep','wake',
                            'ask','tell','say','speak','talk','answer','call','shout',
                            'use','wave','show','point',
                        }
                        _bp_short_verbs = set()
                        for _bp_a in _bp_acts:
                            _bp_toks = _bp_norm(_bp_a).split()
                            if _bp_toks:
                                _bp_short_verbs.add(_bp_toks[0])
                        _bp_allowed = _bp_short_verbs | _bp_universal
                        _bp_orig_norm = _bp_norm(action)
                        _bp_orig_toks = _bp_orig_norm.split() if _bp_orig_norm else []
                        _bp_orig_verb = _bp_orig_toks[0] if _bp_orig_toks else ''
                        # K55-init — hoisted: must be defined for ALL branches
                        # (replaced_cot, replaced_frontier_k54, replaced_failed_exit_k55,
                        # replaced) which all reference _bp_safe_top / _bp_movement_verbs
                        # / _bp_failed_set. Previous version defined these only inside
                        # the score-threshold branch → UnboundLocalError when CoT or
                        # below-threshold paths fired (K55 bench T19/T20/T25).
                        _bp_movement_verbs = {
                            'north','south','east','west','up','down',
                            'northeast','northwest','southeast','southwest',
                            'n','s','e','w','u','d','ne','nw','se','sw',
                            'go','enter','exit','in','out','climb',
                        }
                        _bp_room_key = ''
                        _bp_mod = None
                        try:
                            _bp_room_key = (_bp_data.get('room') or '').strip().lower()
                            _bp_mod = _bp_sys.modules[__name__]
                        except Exception:
                            pass
                        _bp_failed_exits = {}
                        _bp_failed_set = set()
                        if _bp_mod is not None:
                            _bp_failed_exits = _bp_mod.__dict__.setdefault('_bp_failed_exits', {})
                            _bp_last_room = _bp_mod.__dict__.get('_bp_last_room')
                            _bp_last_action = _bp_mod.__dict__.get('_bp_last_action')
                            try:
                                if (_bp_last_room and _bp_last_action
                                        and _bp_room_key
                                        and _bp_last_room == _bp_room_key):
                                    _bp_last_verb = (_bp_last_action.split()[0].lower()
                                                     if _bp_last_action else '')
                                    if _bp_last_verb in _bp_movement_verbs:
                                        _bp_failed_exits.setdefault(
                                            _bp_room_key, set()).add(_bp_last_verb)
                            except Exception:
                                pass
                            _bp_failed_set = _bp_failed_exits.get(_bp_room_key, set()) if _bp_room_key else set()
                        # K69 — same-named-room collision detection.
                        # Some environments (e.g. Zork's Forest) have
                        # multiple distinct rooms sharing one display name.
                        # The patch keys rooms by name, so movement between
                        # them looks like 'didn't move' → every cardinal verb
                        # the agent has tried gets added to _bp_failed_set,
                        # and _bp_safe_top falls through to the first non-
                        # cardinal action ('take forest'), trapping the agent.
                        # If the failed-set covers every cardinal exit the
                        # current observation reports, the room-key is
                        # ambiguous — clear it and let movement resume.
                        try:
                            _bp_compass_pre = {'n','s','e','w','u','d','ne','nw','se','sw','north','south','east','west','up','down','northeast','northwest','southeast','southwest'}
                            _bp_room_exits_set = set()
                            for _bp_alt in _bp_acts:
                                _bp_alt_v_pre = _bp_norm(_bp_alt).split()[0] if _bp_alt else ''
                                if _bp_alt_v_pre in _bp_compass_pre:
                                    _bp_room_exits_set.add(_bp_alt_v_pre)
                            if _bp_room_exits_set and _bp_room_exits_set.issubset(_bp_failed_set):
                                _bp_failed_set = set()
                                if _bp_mod is not None and _bp_room_key:
                                    _bp_failed_exits[_bp_room_key] = set()
                        except Exception:
                            pass
                        _bp_safe_top = _bp_top
                        try:
                            # K69 — prefer cardinal/movement verbs in the
                            # safe-top fallback. Manipulation verbs on visible
                            # scenery (`take forest`) should only be a last
                            # resort when no movement verb is available.
                            _bp_compass_pre2 = {'n','s','e','w','u','d','ne','nw','se','sw','north','south','east','west','up','down','northeast','northwest','southeast','southwest'}
                            _bp_safe_cardinal = ''
                            _bp_safe_other = ''
                            for _bp_alt in _bp_acts:
                                _bp_alt_norm = _bp_norm(_bp_alt)
                                _bp_alt_v = _bp_alt_norm.split()[0] if _bp_alt_norm else ''
                                if not _bp_alt_v or _bp_alt_v in _bp_failed_set:
                                    continue
                                if _bp_alt_v in _bp_compass_pre2 and not _bp_safe_cardinal:
                                    _bp_safe_cardinal = _bp_alt
                                elif not _bp_safe_other:
                                    _bp_safe_other = _bp_alt
                                if _bp_safe_cardinal:
                                    break
                            if _bp_safe_cardinal:
                                _bp_safe_top = _bp_safe_cardinal
                            elif _bp_safe_other:
                                _bp_safe_top = _bp_safe_other
                        except Exception:
                            pass
                        # K59 — hoist info_only / tried_set / orig_tuple so
                        # the elif chain (replaced_repeat_examine_k58, etc.)
                        # and the end-of-call recorder always see them.
                        # K58 originally defined these only inside the
                        # frontier branch → elif at outer level read them
                        # before assignment → UnboundLocalError every turn.
                        _bp_info_only = {
                            'examine','x','look','l','read',
                            'inventory','i','smell','listen','touch','feel','search',
                        }
                        _bp_orig_nouns = _bp_orig_toks[1:] if len(_bp_orig_toks) >= 2 else []
                        _bp_orig_tuple = (_bp_orig_verb, tuple(_bp_orig_nouns)) if _bp_orig_nouns else None
                        _bp_tried_examines = (_bp_mod.__dict__.setdefault('_bp_tried_examines', {})
                                              if _bp_mod is not None else {})
                        _bp_tried_set = _bp_tried_examines.get(_bp_room_key, set()) if _bp_room_key else set()
                        # K46 — chain-of-thought contamination guard.
                        # Real text-adventure actions are short (≤6
                        # tokens like 'take small egg from nest') and
                        # never contain newlines or quote marks. LLMs
                        # sometimes emit reasoning-then-action as one
                        # blob (~80 tokens) which bypasses K27/K44/K45
                        # because reasoning text contains visible nouns
                        # and whitelisted verbs as bag-of-words. Zork
                        # cannot parse such input — the turn is wasted.
                        # Universal (no domain content): just linguistic
                        # structure. Replace blob with planner top.
                        _bp_action_raw = action or ''
                        _bp_orig_is_cot = (
                            len(_bp_orig_toks) > 6
                            or '\n' in _bp_action_raw
                            or '"' in _bp_action_raw
                            or "'" in _bp_action_raw
                        )
                        if _bp_orig_is_cot:
                            # K60 — extract trailing imperative from CoT
                            # before falling back to safe_top. Many LLM
                            # CoTs end with a clean 1-3 token command
                            # (e.g. last line 'examine egg', or '...action: look').
                            # K58 bench T22 lost 'examine egg', K59 T20 lost
                            # 'look', K59-A T23 lost 'move northwest' (real
                            # exit) — all because of full-CoT replacement.
                            # Generic AGI rule: last non-narrative line whose
                            # first/last 1-3 tokens form a valid (verb [noun])
                            # action wins. No domain content.
                            _bp_extracted = ''
                            try:
                                _bp_lines = [l.strip().lower() for l in _bp_action_raw.splitlines() if l.strip()]
                                _bp_narrative = {'i','my','we','the','this','that','because','since','so','now','then','first','next','also','however','therefore','it','they'}
                                # K62 — reject preposition-leading tails
                                # like 'in the forest.]' which K60 grabbed
                                # from a bracketed CoT closing line. Generic
                                # English preposition set, no domain content.
                                _bp_prepositions = {'in','on','at','to','from','by','with','of','for','into','onto','upon','about','over','under','around','through'}
                                _bp_short_verb_set = _bp_short_verbs | _bp_universal
                                for _bp_line in reversed(_bp_lines[-4:]):
                                    # K62 — strip square brackets and quotes too
                                    _bp_line_clean = _bp_line.strip('[](){}"\' ').rstrip('.!?,;:"\' ').strip()
                                    _bp_line_toks = _bp_line_clean.split()
                                    if not _bp_line_toks:
                                        continue
                                    # bare cardinal direction line
                                    if len(_bp_line_toks) == 1 and _bp_line_toks[0] in _bp_movement_verbs:
                                        _bp_extracted = _bp_line_toks[0]
                                        break
                                    # 2-3 token clean command line
                                    if (1 <= len(_bp_line_toks) <= 3
                                            and _bp_line_toks[0] in _bp_short_verb_set
                                            and _bp_line_toks[0] not in _bp_narrative
                                            and _bp_line_toks[0] not in _bp_prepositions):
                                        _bp_extracted = ' '.join(_bp_line_toks)
                                        break
                                    # trailing 1-3 tokens of a longer line
                                    for _bp_n_take in (3, 2, 1):
                                        if len(_bp_line_toks) > _bp_n_take:
                                            _bp_tail = _bp_line_toks[-_bp_n_take:]
                                            _bp_tail_verb = _bp_tail[0]
                                            if (_bp_tail_verb in _bp_short_verb_set
                                                    and _bp_tail_verb not in _bp_narrative
                                                    and _bp_tail_verb not in _bp_prepositions):
                                                _bp_extracted = ' '.join(_bp_tail)
                                                break
                                            if (_bp_n_take == 1 and _bp_tail_verb in _bp_movement_verbs):
                                                _bp_extracted = _bp_tail_verb
                                                break
                                    if _bp_extracted:
                                        break
                            except Exception:
                                _bp_extracted = ''
                            if _bp_extracted:
                                _bp_status = 'extracted_cot_k60'
                                action = _bp_extracted
                            else:
                                _bp_status = 'replaced_cot'
                                action = _bp_safe_top
                        elif _bp_orig_verb in _bp_movement_verbs and _bp_orig_verb in _bp_failed_set:
                            # K56 — hoisted above passthrough/frontier so a
                            # known-failed movement verb is ALWAYS replaced,
                            # even when planner top is the same failed verb
                            # (passthrough) or the score is at frontier
                            # (allow_llm_cardinal_tie). Without this, K55
                            # never fired in K55-bench because LLM 'north'
                            # matched planner top 'north' → passthrough.
                            _bp_status = 'replaced_failed_exit_k55'
                            action = _bp_safe_top
                        elif _bp_orig_norm == _bp_norm(_bp_top):
                            _bp_status = 'passthrough'
                        elif _bp_top_score >= _bp_frontier_threshold:
                            # K31: planner has a strong recommendation;
                            # weak LLM cannot bypass with safe verbs.
                            # K44/K45 — 'no information advantage'
                            # exceptions: when planner top is at exactly
                            # FRONTIER_BONUS (no stable-noun action above
                            # frontier), the planner has no informational
                            # advantage. K42 explicitly caps all unstable-
                            # noun actions at FRONTIER-1=5, so a top of 6
                            # is necessarily a cardinal exit. Two cases
                            # where LLM may know better:
                            # K44: cardinal-vs-cardinal at frontier.
                            # K45: LLM proposes verb-noun where the noun
                            # is visible in the shortlist (planner saw it,
                            # capped it at 5, but couldn't rank which is
                            # the right noun-action). LLM can read game
                            # text hints (containers, openables).
                            # Pin still fires for: hallucinated nouns NOT
                            # in shortlist, or any LLM action when stable
                            # noun pushes top above FRONTIER_BONUS.
                            _bp_compass = {
                                'n','s','e','w','u','d',
                                'ne','nw','se','sw',
                                'north','south','east','west','up','down',
                                'northeast','northwest','southeast','southwest',
                            }
                            _bp_top_norm = _bp_norm(_bp_top)
                            _bp_visible_nouns = set()
                            for _bp_a in _bp_acts:
                                _bp_a_toks = _bp_norm(_bp_a).split()
                                if len(_bp_a_toks) >= 2:
                                    for _bp_tk in _bp_a_toks[1:]:
                                        _bp_visible_nouns.add(_bp_tk)
                            # K49 — also accept nouns that appear in the
                            # CURRENT room observation. K48 reached End
                            # Rainbow and the LLM correctly proposed
                            # 'examine pot gold' (canonical Zork scoring
                            # action), but `pot`/`gold` were not in any
                            # shortlist entry because `_OBJ_PATTERNS`
                            # didn't match the 'is a pot of gold.' phrasing
                            # (no `here` terminator). K45 then force-
                            # replaced 11+ correct LLM actions with
                            # cardinal frontier exits. observation_nouns
                            # is the set of noun-like tokens in the recent
                            # game text — universal IF semantic, no domain
                            # content. Pin still rejects pure hallucinations
                            # (nouns NOT in the room text).
                            try:
                                _bp_obs_nouns = _bp_data.get('observation_nouns') or []
                                for _bp_on in _bp_obs_nouns:
                                    if isinstance(_bp_on, str):
                                        _bp_visible_nouns.add(_bp_on.strip().lower())
                            except Exception:
                                pass
                            # K73 — per-room fixed nouns (take produced no
                            # inventory change). Outcome-driven, AGI-pure.
                            # Used by K73 passthrough branch + K68/K63 filters
                            # so a manipulation verb on a fixed noun is not
                            # re-replaced with a useless force-take or with
                            # a cardinal frontier exit.
                            _bp_fixed_nouns = set()
                            try:
                                for _bp_fn in (_bp_data.get('fixed_nouns') or []):
                                    if isinstance(_bp_fn, str):
                                        _bp_fixed_nouns.add(_bp_fn.strip().lower())
                            except Exception:
                                pass
                            # K53 — persistent per-room visible nouns.
                            # K52 bench reached Up a Tree at turn 20.
                            # The LLM correctly proposed 'open egg' / 
                            # 'examine egg' 4+ times at turn 21–22 (the
                            # canonical Zork +5 jewel-egg path), but the
                            # current-turn observation_nouns was empty
                            # (room obs collapsed after first arrival),
                            # so K49 rejected and replaced with phantom
                            # frontier cardinals — none of which are
                            # real exits at Up a Tree. Universal IF rule:
                            # nouns observed in a room remain present
                            # until the agent leaves the room. Persist
                            # visible_nouns per room across turns.
                            # K54 — also track per-room visit count.
                            # K52 bench (which always blocked info-only
                            # verbs at frontier) regressed vs K51: at
                            # turn 1 LLM proposed 'examine mailbox' →
                            # K52 replaced with 'west' → agent skipped
                            # West House entirely → never got the
                            # leaflet → stuck wandering Forest. K51
                            # waste was on REVISITS (turns 11/17/19 to
                            # Forest Path/Clearing). Universal rule:
                            # first-visit examination is informative,
                            # second-visit is repeat waste.
                            _bp_room_visits_count = 1
                            try:
                                _bp_room_key = (_bp_data.get('room') or '').strip().lower()
                                _bp_mod = _bp_sys.modules[__name__]
                                _bp_room_nouns = _bp_mod.__dict__.setdefault('_bp_persistent_nouns', {})
                                _bp_room_visits = _bp_mod.__dict__.setdefault('_bp_room_visits', {})
                                if _bp_room_key:
                                    _bp_prev = _bp_room_nouns.get(_bp_room_key) or set()
                                    _bp_visible_nouns |= _bp_prev
                                    _bp_room_nouns[_bp_room_key] = _bp_visible_nouns | _bp_prev
                                    _bp_room_visits_count = _bp_room_visits.get(_bp_room_key, 0) + 1
                                    _bp_room_visits[_bp_room_key] = _bp_room_visits_count
                            except Exception:
                                pass
                            # K58 — per-(room,verb,noun) tried set.
                            # K57 bench reached Up a Tree at T16, T17 LLM
                            # proposed 'examine egg' (allowed, visits=1).
                            # T18 visits=2, LLM proposed 'examine nest'
                            # (correct! egg is IN the nest), but the
                            # info-only-on-revisit gate replaced it with
                            # 'east'. Agent never learned about the egg,
                            # never proposed 'take egg', score=0.
                            # Universal rule: info-only verb on a SPECIFIC
                            # noun is informative once per (room,verb,noun)
                            # tuple, not once per room. Track the tuple,
                            # not the visit count.
                            _bp_tried_examines = _bp_mod.__dict__.setdefault('_bp_tried_examines', {})
                            _bp_tried_set = _bp_tried_examines.get(_bp_room_key, set()) if _bp_room_key else set()
                            # K59 — _bp_orig_nouns / _bp_orig_tuple now hoisted
                            # ABOVE the outer if-chain (just after _bp_safe_top).
                            # K55 setup is hoisted above the if-chain so all
                            # branches (CoT/frontier/failed/replaced) can use
                            # _bp_safe_top, _bp_movement_verbs, _bp_failed_set.
                            _bp_at_frontier = _bp_top_score <= _bp_frontier_threshold
                            # K52 — info-only verbs never score in
                            # text adventures. K51 bench iter wasted 4
                            # turns at frontier-rich rooms (Forest Path,
                            # Clearing) on 'examine tree'/'examine leaves'
                            # while untried frontier exits like 'up' (the
                            # +5 jewel egg path) sat at top score=6.
                            # Universal rule: when an untried frontier
                            # cardinal is available, prefer exploration
                            # over information-gathering. The LLM can
                            # always come back to examine after the
                            # frontier is exhausted.
                            # K59 — _bp_info_only hoisted above outer if-chain.
                            if (
                                _bp_at_frontier
                                and _bp_orig_norm in _bp_compass
                                and _bp_top_norm in _bp_compass
                            ):
                                # K67 — vertical-cardinal preference at
                                # cardinal-tie. LLMs bias strongly toward
                                # horizontal compass moves (n/s/e/w) over
                                # vertical (up/down). When the planner has
                                # `up` or `down` tied at the same frontier
                                # score and the LLM picked a horizontal,
                                # rotate to the vertical exit. Universal
                                # text-adventure / spatial-exploration rule:
                                # vertical exits open new layers and are
                                # under-explored by language priors. AGI-
                                # pure: no Zork-specific noun seeded.
                                _bp_k67_vertical = ''
                                try:
                                    _bp_horiz = {'north','south','east','west','northeast','northwest','southeast','southwest'}
                                    _bp_vert = {'up','down'}
                                    if _bp_orig_norm in _bp_horiz:
                                        for _bp_a in _bp_acts:
                                            _bp_a_norm = str(_bp_a).strip().lower()
                                            if _bp_a_norm in _bp_vert and _bp_a_norm != _bp_orig_norm:
                                                if (_bp_a_norm,) not in _bp_failed_set and _bp_a_norm not in _bp_failed_set:
                                                    _bp_k67_vertical = _bp_a_norm
                                                    break
                                except Exception:
                                    _bp_k67_vertical = ''
                                if _bp_k67_vertical:
                                    _bp_status = 'force_vertical_cardinal_k67'
                                    action = _bp_k67_vertical
                                else:
                                    _bp_status = 'allow_llm_cardinal_tie'
                            elif (
                                _bp_at_frontier
                                and _bp_orig_norm in _bp_compass
                                and _bp_orig_norm not in _bp_failed_set
                            ):
                                # K70 — unfailed-compass passthrough. Fires
                                # AFTER K67's cardinal-tie branch (which only
                                # triggers when top is also compass) so the
                                # vertical-cardinal preference still wins
                                # against horizontal LLM drift. K70 catches
                                # the case where top is non-compass (e.g.
                                # `take egg` after the egg was already
                                # acquired but stays in visible_nouns,
                                # scoring rank-1 forever). Without K70, K54
                                # below would replace LLM's correct `down`
                                # with `take egg` and trap the agent.
                                # Generic AGI rule: when LLM proposes a
                                # compass direction not yet bumped here,
                                # the LLM's exit knowledge beats the noisy
                                # InfoExtractor (which sometimes lists
                                # phantom cardinals). AGI-pure structural.
                                _bp_status = 'allow_llm_unfailed_compass_k70'
                            elif (
                                _bp_at_frontier
                                and _bp_orig_verb in _bp_allowed
                                and _bp_orig_verb not in _bp_info_only
                                and _bp_orig_verb != 'take'
                                and _bp_orig_verb not in _bp_compass
                                and _bp_orig_nouns
                                and any(_bp_n in _bp_fixed_nouns for _bp_n in _bp_orig_nouns)
                            ):
                                # K73 — fixed-noun passthrough. When the
                                # LLM proposes a manipulation verb (open,
                                # move, push, pull, enter, climb, light...)
                                # on a noun whose prior `take` produced no
                                # inventory change in this room, the noun
                                # is scenery rather than a portable item.
                                # K68 force-take would re-trigger a no-op,
                                # K54 frontier-replace would discard the
                                # one promising scenery-interaction in favor
                                # of cardinal wandering (K72 Zork run: Behind
                                # House → take window neutral → open window
                                # replaced with `up` → never entered house).
                                # Outcome-driven, AGI-pure: the portable/
                                # fixed distinction emerges from observed
                                # take outcomes, not from any seeded list.
                                _bp_status = 'passthrough_fixed_noun_k73'
                            elif (
                                _bp_at_frontier
                                and _bp_orig_verb in _bp_allowed
                                and (_bp_orig_verb not in _bp_info_only or _bp_orig_tuple is None or _bp_orig_tuple not in _bp_tried_set)
                                and _bp_orig_nouns
                                and any(_bp_n in _bp_visible_nouns for _bp_n in _bp_orig_nouns)
                            ):
                                # K68 — acquisition-before-manipulation.
                                # When LLM proposes a manipulation verb
                                # (open/light/move/read/climb/enter etc) on
                                # a visible noun and `take <noun>` is still
                                # untried, force the take first. Universal
                                # rule across object-collection environments:
                                # acquisition (`take`) precedes manipulation
                                # because score/inventory/state-progression
                                # gate on possession. K67 reached Up a Tree
                                # with the egg visible, but LLM proposed
                                # `examine egg`, `open egg`, `open clasp` —
                                # never `take egg` (the +5pt scoring action).
                                # `take egg` was in scored20 but not top-12
                                # shortlist, so K65's shortlist-validation
                                # blocked the K63 fallback. K68 fires earlier
                                # in the chain, on the LLM's own noun choice.
                                _bp_k68_take = ''
                                try:
                                    _bp_stop68 = {'the','a','an','this','that','these','those','it','them','their','your','my','his','her','its','of','to','in','on','at','from','by','with','for','about','all','and','or','but','so','is','are','was','were','be','been','have','has','had','will','would','can','could'}
                                    if _bp_orig_verb != 'take' and _bp_orig_nouns:
                                        for _bp_n in _bp_orig_nouns:
                                            if (len(_bp_n) >= 3
                                                    and _bp_n not in _bp_stop68
                                                    and _bp_n not in _bp_compass
                                                    and _bp_n in _bp_visible_nouns
                                                    and _bp_n not in _bp_fixed_nouns
                                                    and ('take', (_bp_n,)) not in _bp_tried_set):
                                                _bp_k68_take = 'take ' + _bp_n
                                                break
                                except Exception:
                                    _bp_k68_take = ''
                                if _bp_k68_take:
                                    _bp_status = 'force_take_before_manipulate_k68'
                                    action = _bp_k68_take
                                else:
                                    _bp_status = 'allow_llm_visible_noun'
                            else:
                                # K63 — force-take untried noun before
                                # falling back to cardinal exploration.
                                # Generic AGI rule: examine/open/look on a
                                # visible noun without prior `take` is
                                # incomplete. Acquisition before exploration
                                # is universal across text adventures.
                                # K62 reached Up a Tree with `egg` in
                                # visible_nouns and `take egg` in shortlist,
                                # but LLM only said examine/open and harness
                                # rotated to cardinal `down` — left without
                                # the 5-point egg.
                                _bp_k63_take = ''
                                try:
                                    _bp_stop63 = {'the','a','an','this','that','these','those','it','them','their','your','my','his','her','its','of','to','in','on','at','from','by','with','for','about','all','and','or','but','so','is','are','was','were','be','been','have','has','had','will','would','can','could'}
                                    # K68 — dropped K65's shortlist-only gate.
                                    # The bridge top-12 shortlist often excludes
                                    # `take <treasure>` (rank ~22 in scored20),
                                    # which blocked legitimate force-takes. The
                                    # _bp_stop63 filter + len>=3 + visible_nouns
                                    # check is sufficient to prevent K64-style
                                    # junk substitutions.
                                    if _bp_orig_nouns:
                                        for _bp_n in _bp_orig_nouns:
                                            if (len(_bp_n) >= 3
                                                    and _bp_n not in _bp_stop63
                                                    and _bp_n not in _bp_compass
                                                    and _bp_n in _bp_visible_nouns
                                                    and _bp_n not in _bp_fixed_nouns
                                                    and ('take', (_bp_n,)) not in _bp_tried_set):
                                                _bp_k63_take = 'take ' + _bp_n
                                                break
                                except Exception:
                                    _bp_k63_take = ''
                                if _bp_k63_take:
                                    _bp_status = 'force_take_orig_noun_k63'
                                    action = _bp_k63_take
                                else:
                                    _bp_status = 'replaced_frontier_k54'
                                    action = _bp_safe_top
                        elif _bp_orig_verb in _bp_info_only and _bp_orig_tuple is not None and _bp_orig_tuple in _bp_tried_set:
                            # K58 — LLM repeating an examine on the
                            # same noun at the same room. No new info.
                            _bp_status = 'replaced_repeat_examine_k58'
                            action = _bp_safe_top
                        elif _bp_orig_verb and _bp_orig_verb in _bp_allowed:
                            _bp_status = 'allow_llm'
                        else:
                            _bp_status = 'replaced'
                            action = _bp_safe_top
                # K55 — record (room, action) so next call can detect failure.
                try:
                    if _bp_room_key:
                        _bp_mod.__dict__['_bp_last_room'] = _bp_room_key
                        _bp_mod.__dict__['_bp_last_action'] = action
                        # K58 — record (verb, noun-tuple) tried at this room
                        # so a later proposal of the same tuple is treated
                        # as repeat info-only waste.
                        _bp_act_toks = _bp_norm(action).split() if action else []
                        if len(_bp_act_toks) >= 2 and _bp_act_toks[0] in _bp_info_only:
                            _bp_te = _bp_mod.__dict__.setdefault('_bp_tried_examines', {})
                            _bp_te.setdefault(_bp_room_key, set()).add((_bp_act_toks[0], tuple(_bp_act_toks[1:])))
                        # K63 — also track `take` so force_take_orig_noun_k63
                        # doesn't loop on the same noun if Zork rejects it.
                        if len(_bp_act_toks) >= 2 and _bp_act_toks[0] == 'take':
                            _bp_te = _bp_mod.__dict__.setdefault('_bp_tried_examines', {})
                            _bp_te.setdefault(_bp_room_key, set()).add((_bp_act_toks[0], tuple(_bp_act_toks[1:])))
                except Exception:
                    pass
                _bp_sys.stderr.write(
                    f'[BRAIN-PIN-K49] status={_bp_status} '
                    f'orig={_bp_orig!r} top={_bp_top!r} top_score={_bp_top_score} n={_bp_n}\n'
                )
                _bp_sys.stderr.flush()
            except Exception as _bp_e:
                try:
                    import sys as _bp_sys2
                    _bp_sys2.stderr.write(f'[BRAIN-PIN-K49] exception={_bp_e!r}\n')
                    _bp_sys2.stderr.flush()
                except Exception:
                    pass

            # Validate action is not empty
            if not action or action.isspace():
                if self.logger:
                    self.logger.warning(
                        "Agent returned empty action, using 'look' as fallback"
                    )
                action = "look"

            return {
                "action": action,
                "reasoning": reasoning if reasoning else None,
                "raw_response": raw_response,
            }
        except Exception as e:
            if self.logger:
                self.logger.error(
                    f"Error getting agent action: {e}",
                    extra={"episode_id": self.episode_id},
                )
            return {
                "action": "look",
                "reasoning": None,
                "raw_response": None,
            }  # Default safe action on error

    def get_relevant_memories_for_prompt(
        self,
        current_location_name_from_current_extraction: str,
        memory_log_history: List[ExtractorResponse],
        current_inventory: List[str],
        game_map: MapGraph,
        previous_room_name_for_map_context: Optional[str] = None,
        action_taken_to_current_room: Optional[str] = None,
        in_combat: bool = False,
        failed_actions_by_location: Optional[dict] = None,
    ) -> str:
        """
        Generate relevant memories and context for the agent prompt.

        Args:
            current_location_name_from_current_extraction: Current room name
            memory_log_history: History of extracted information
            current_inventory: Current inventory items
            game_map: The game map object
            previous_room_name_for_map_context: Previous room name
            action_taken_to_current_room: Action that led to current room
            in_combat: Whether currently in combat
            failed_actions_by_location: Dict of failed actions by location

        Returns:
            Formatted string of relevant memories for the agent
        """
        # Check for loop situation - if agent has been in same location for multiple recent turns
        recent_locations = []
        if memory_log_history and len(memory_log_history) >= 3:
            # Check last 5 turns for same location
            for obs in memory_log_history[-5:]:
                if obs.current_location_name:
                    recent_locations.append(obs.current_location_name)

        # Count how many of the recent turns were in current location
        current_location_count = recent_locations.count(
            current_location_name_from_current_extraction
        )
        is_stuck_in_loop = current_location_count >= 3

        map_context_str = ""
        if game_map:
            map_info = game_map.get_context_for_prompt(
                current_room_name=current_location_name_from_current_extraction,
                previous_room_name=previous_room_name_for_map_context,
                action_taken_to_current=action_taken_to_current_room,
            )

            # Add navigation suggestions to the map context
            nav_suggestions = game_map.get_navigation_suggestions(
                current_location_name_from_current_extraction
            )
            if nav_suggestions:
                nav_text = "Available exits: " + ", ".join(
                    [
                        f"{suggestion['exit']} (to {suggestion['destination']})"
                        for suggestion in nav_suggestions
                    ]
                )

                # If stuck in loop, make navigation more prominent
                if is_stuck_in_loop:
                    nav_text = f"🚨 LOOP DETECTED - PRIORITIZE MOVEMENT! 🚨\n{nav_text}\n⚠️  You've been in {current_location_name_from_current_extraction} for {current_location_count} recent turns. Try these exits NOW!"

                if map_info:
                    map_info += f"\n{nav_text}"
                else:
                    map_info = f"--- Map Information ---\n{nav_text}"

            if map_info:
                map_context_str = map_info

        other_memory_strings = []

        # Add loop detection warning at the top of other memories
        if is_stuck_in_loop:
            other_memory_strings.append(
                f"🔄 CRITICAL LOOP WARNING: You have been in '{current_location_name_from_current_extraction}' for {current_location_count} of your last 5 turns! STOP object interactions and try MOVEMENT commands immediately. Check the Available exits above and use basic directional commands like 'north', 'south', 'east', 'west'."
            )

        # Add combat status information
        if in_combat:
            other_memory_strings.append(
                "- COMBAT SITUATION: You are currently in combat or facing an immediate threat! Be prepared to defend yourself or flee."
            )

        if current_inventory:
            other_memory_strings.append(
                f"- You are carrying: {', '.join(current_inventory)}."
            )

        # Add failed actions warning for current location
        if (
            failed_actions_by_location
            and current_location_name_from_current_extraction
            in failed_actions_by_location
        ):
            failed_actions = failed_actions_by_location[
                current_location_name_from_current_extraction
            ]
            if failed_actions:
                other_memory_strings.append(
                    f"- FAILED ACTIONS in {current_location_name_from_current_extraction}: The following actions have already failed here and should NOT be repeated: {', '.join(sorted(failed_actions))}."
                )

        previous_observations_of_current_room = [
            obs
            for obs in reversed(memory_log_history[:-1])  # Exclude current observation
            if obs.current_location_name
            == current_location_name_from_current_extraction
        ]

        if previous_observations_of_current_room:
            last_relevant_obs = previous_observations_of_current_room[0]
            prev_objects = last_relevant_obs.visible_objects
            if prev_objects:
                other_memory_strings.append(
                    f"- Previously noted objects in {current_location_name_from_current_extraction}: {', '.join(prev_objects)}."
                )

        if memory_log_history:
            # Always use the most recent memory entry
            # This contains the result from the last action taken
            relevant_history_index = -1
            last_turn_info = memory_log_history[relevant_history_index]
            important_msgs = last_turn_info.important_messages
            action_results = [
                msg
                for msg in important_msgs
                if not msg.lower().startswith("you are")
                and not msg.lower().startswith(
                    current_location_name_from_current_extraction.lower()
                )
                and len(msg) < 100
            ]
            if action_results:
                other_memory_strings.append(
                    f"- Last action result/event: {' '.join(action_results)}."
                )

        final_output_parts = []
        if map_context_str and map_context_str.strip():
            content_part = map_context_str.replace(
                "--- Map Information ---", ""
            ).strip()
            if content_part:  # Only add if there's more than just the header
                final_output_parts.append(map_context_str)

        if other_memory_strings:  # other_memory_strings is populated by existing logic
            if final_output_parts:
                final_output_parts.append("\n--- Other Relevant Memories ---")
            else:
                final_output_parts.append("--- Relevant Memories ---")
            final_output_parts.extend(other_memory_strings)

        if not final_output_parts:
            return ""
        return "\n".join(final_output_parts) + "\n"

    def update_episode_id(self, episode_id: str) -> None:
        """Update the episode ID for logging purposes."""
        self.episode_id = episode_id

    def reload_knowledge_base(self) -> bool:
        """Reload the knowledge base from file and update the system prompt.

        Returns:
            True if knowledge base was successfully reloaded, False otherwise
        """
        try:
            # Load base agent prompt
            with open("agent.md") as fh:
                base_agent_prompt = fh.read()

            # Re-enhance with current knowledge base
            new_system_prompt = self._enhance_prompt_with_knowledge(base_agent_prompt)

            # Update the system prompt
            old_length = (
                len(self.system_prompt) if hasattr(self, "system_prompt") else 0
            )
            self.system_prompt = new_system_prompt
            new_length = len(self.system_prompt)

            if self.logger:
                self.logger.info(
                    f"Knowledge base reloaded successfully (prompt: {old_length} -> {new_length} chars)",
                    extra={
                        "event_type": "knowledge_base_reloaded",
                        "episode_id": self.episode_id,
                        "old_prompt_length": old_length,
                        "new_prompt_length": new_length,
                    },
                )

            return True

        except Exception as e:
            if self.logger:
                self.logger.warning(
                    f"Failed to reload knowledge base: {e}",
                    extra={"episode_id": self.episode_id},
                )
            return False
