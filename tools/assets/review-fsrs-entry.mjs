/**
 * 复习卡的排程算法：ts-fsrs（FSRS-6，Anki 新版用的同一套）。
 * Build: npm run build:learning-editor（和代码小屋的两份打包一起生成）。
 * 只在复习页加载，见 source/js/review.js。
 */
import { createEmptyCard, fsrs, generatorParameters, Rating, State, TypeConvert } from 'ts-fsrs'

window.NOIMPTY_FSRS = Object.freeze({ createEmptyCard, fsrs, generatorParameters, Rating, State, TypeConvert })
