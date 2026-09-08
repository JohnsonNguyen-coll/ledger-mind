import { askAgentQuestion } from '../api/client.js';
import { $ } from '../utils/formatters.js';

export function initChatCopilot(getCurrentReportId: () => string | null) {
  // Bind Prompt Chips
  document.querySelectorAll<HTMLButtonElement>('.chip-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const question = btn.dataset.question;
      if (question) {
        const input = $<HTMLInputElement>('chat-question');
        input.value = question;
        input.focus();
      }
    });
  });

  // Bind Form Submit
  $('chat-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const reportId = getCurrentReportId();
    if (!reportId) return;

    const questionInput = $<HTMLInputElement>('chat-question');
    const question = questionInput.value.trim();
    if (!question) return;

    $('chat-status').textContent = 'Thinking';
    const log = $('chat-log');
    
    const userLine = document.createElement('p');
    userLine.className = 'chat-user';
    userLine.textContent = question;
    log.append(userLine);

    try {
      const response = await askAgentQuestion(reportId, question);
      const answerLine = document.createElement('p');
      answerLine.className = 'chat-answer';
      answerLine.textContent = response.answer;
      log.append(answerLine);
      questionInput.value = '';
      $('chat-status').textContent = 'Ready';
    } catch (err) {
      const answerLine = document.createElement('p');
      answerLine.className = 'chat-answer error-text';
      answerLine.textContent = err instanceof Error ? err.message : 'Unable to answer';
      log.append(answerLine);
      $('chat-status').textContent = 'Failed';
    }
  });
}
