export interface PendingApproval {
  toolName: string;
  input: Record<string, unknown>;
  resolve: (allowed: boolean) => void;
}

export class ApprovalQueue {
  private pending = new Map<string, PendingApproval>();
  private counter = 0;

  requestApproval(
    toolName: string,
    input: Record<string, unknown>
  ): { id: string; promise: Promise<boolean> } {
    const id = `approval_${++this.counter}_${Date.now()}`;
    const promise = new Promise<boolean>((resolve) => {
      this.pending.set(id, { toolName, input, resolve });
    });
    return { id, promise };
  }

  resolveApproval(id: string, allowed: boolean): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.pending.delete(id);
    entry.resolve(allowed);
    return true;
  }

  get size(): number {
    return this.pending.size;
  }

  denyAll(): void {
    for (const [, entry] of this.pending) {
      entry.resolve(false);
    }
    this.pending.clear();
  }
}

// --- Question queue for AskUserQuestion ---

export interface QuestionOption {
  label: string;
  description: string;
}

export interface QuestionItem {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

export interface PendingQuestion {
  questions: QuestionItem[];
  /** answers collected so far: question text → selected label(s) */
  answers: Record<string, string>;
  /** for multiSelect: tracks selected labels per question */
  multiAnswers: Record<string, Set<string>>;
  /** index of the question currently being answered */
  currentIndex: number;
  /** whether the current question is waiting for custom text input */
  waitingForText: boolean;
  resolve: (answers: Record<string, string>) => void;
}

export class QuestionQueue {
  private pending = new Map<string, PendingQuestion>();
  private counter = 0;

  createQuestion(
    questions: QuestionItem[]
  ): { id: string; promise: Promise<Record<string, string>> } {
    const id = `question_${++this.counter}_${Date.now()}`;
    const promise = new Promise<Record<string, string>>((resolve) => {
      this.pending.set(id, {
        questions,
        answers: {},
        multiAnswers: {},
        currentIndex: 0,
        waitingForText: false,
        resolve,
      });
    });
    return { id, promise };
  }

  get(id: string): PendingQuestion | undefined {
    return this.pending.get(id);
  }

  /** Answer a single-select question or provide custom text. Returns the next question index, or -1 if done. */
  answerCurrent(id: string, answer: string): number {
    const entry = this.pending.get(id);
    if (!entry) return -1;
    const q = entry.questions[entry.currentIndex];
    entry.answers[q.question] = answer;
    entry.waitingForText = false;
    entry.currentIndex++;
    if (entry.currentIndex >= entry.questions.length) {
      this.pending.delete(id);
      entry.resolve(entry.answers);
      return -1;
    }
    return entry.currentIndex;
  }

  /** Toggle an option for multiSelect. Returns current selections. */
  toggleMulti(id: string, label: string): Set<string> | undefined {
    const entry = this.pending.get(id);
    if (!entry) return undefined;
    const q = entry.questions[entry.currentIndex];
    if (!entry.multiAnswers[q.question]) {
      entry.multiAnswers[q.question] = new Set();
    }
    const set = entry.multiAnswers[q.question];
    if (set.has(label)) set.delete(label);
    else set.add(label);
    return set;
  }

  /** Confirm multiSelect and move to next question. Returns next index or -1 if done. */
  confirmMulti(id: string): number {
    const entry = this.pending.get(id);
    if (!entry) return -1;
    const q = entry.questions[entry.currentIndex];
    const set = entry.multiAnswers[q.question] || new Set();
    entry.answers[q.question] = [...set].join(", ");
    entry.currentIndex++;
    if (entry.currentIndex >= entry.questions.length) {
      this.pending.delete(id);
      entry.resolve(entry.answers);
      return -1;
    }
    return entry.currentIndex;
  }

  setWaitingForText(id: string, waiting: boolean): void {
    const entry = this.pending.get(id);
    if (entry) entry.waitingForText = waiting;
  }

  /** Find a question that is waiting for text input from a specific user (used with reply matching). */
  findWaitingForText(): { id: string; entry: PendingQuestion } | undefined {
    for (const [id, entry] of this.pending) {
      if (entry.waitingForText) return { id, entry };
    }
    return undefined;
  }

  denyAll(): void {
    for (const [, entry] of this.pending) {
      entry.resolve({});
    }
    this.pending.clear();
  }
}
