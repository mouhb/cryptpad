define(function () {

/**
 * Licensed under the standard MIT license:
 *
 * Copyright 2011 Joseph Gentle.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 * See: https://github.com/share/ShareJS/blob/master/LICENSE
 */

/* This contains the textarea binding for ShareJS. This binding is really
 * simple, and a bit slow on big documents (Its O(N). However, it requires no
 * changes to the DOM and no heavy libraries like ace. It works for any kind of
 * text input field.
 *
 * You probably want to use this binding for small fields on forms and such.
 * For code editors or rich text editors or whatever, I recommend something
 * heavier.
 */


/* applyChange creates the edits to convert oldval -> newval.
 *
 * This function should be called every time the text element is changed.
 * Because changes are always localised, the diffing is quite easy. We simply
 * scan in from the start and scan in from the end to isolate the edited range,
 * then delete everything that was removed & add everything that was added.
 * This wouldn't work for complex changes, but this function should be called
 * on keystroke - so the edits will mostly just be single character changes.
 * Sometimes they'll paste text over other text, but even then the diff
 * generated by this algorithm is correct.
 *
 * This algorithm is O(N). I suspect you could speed it up somehow using regular expressions.
 */
var applyChange = function(ctx, oldval, newval) {
  // Strings are immutable and have reference equality. I think this test is O(1), so its worth doing.
  if (oldval === newval) return;

  var commonStart = 0;
  while (oldval.charAt(commonStart) === newval.charAt(commonStart)) {
    commonStart++;
  }

  var commonEnd = 0;
  while (oldval.charAt(oldval.length - 1 - commonEnd) === newval.charAt(newval.length - 1 - commonEnd) &&
      commonEnd + commonStart < oldval.length && commonEnd + commonStart < newval.length) {
    commonEnd++;
  }

  if (oldval.length !== commonStart + commonEnd) {
    ctx.remove(commonStart, oldval.length - commonStart - commonEnd);
  }
  if (newval.length !== commonStart + commonEnd) {
    ctx.insert(commonStart, newval.slice(commonStart, newval.length - commonEnd));
  }
};

/**
 * Fix issues with textarea content which is different per-browser.
 */
var cannonicalize = function (content) {

    return content.replace(/\r\n/g, '\n');
};

// Attach a textarea to a document's editing context.
//
// The context is optional, and will be created from the document if its not
// specified.
var attachTextarea = function(elem, ctx, cmElem) {

  // initial state will always fail the !== check in genop.
  var content = {};

  // Replace the content of the text area with newText, and transform the
  // current cursor by the specified function.
  var replaceText = function(newText, transformCursor, transformCursorCM) {
    if(cmElem) {
      // Fix cursor here?
      var cursorCM = cmElem.getCursor();
      var cursorCMStart = cmElem.getCursor('from');
      var cursorCMEnd = cmElem.getCursor('to');
      var newCursor;
      var newSelection;
      if(cursorCMStart !== cursorCMEnd) {
        newSelection = [transformCursorCM(elem.value, cursorCMStart), transformCursorCM(elem.value, cursorCMEnd)];
      }
      else {
        newCursor = transformCursorCM(elem.value, cursorCM);
      }
    }
    
    if (transformCursor && !cmElem) {
      var newSelection = [transformCursor(elem.selectionStart), transformCursor(elem.selectionEnd)];
    }

    // Fixate the window's scroll while we set the element's value. Otherwise
    // the browser scrolls to the element.
    var scrollTop = elem.scrollTop;
    elem.value = newText;
    if(cmElem) {
      // Fix cursor here?
      cmElem.setValue(newText);
      if(newCursor) {
        cmElem.setCursor(newCursor);
      }
      else {
        cmElem.setSelection(newSelection[0], newSelection[1]);
      }
    }
    content = elem.value; // Not done on one line so the browser can do newline conversion.
    
    if(!cmElem) {
      if (elem.scrollTop !== scrollTop) elem.scrollTop = scrollTop;

      // Setting the selection moves the cursor. We'll just have to let your
      // cursor drift if the element isn't active, though usually users don't
      // care.
      if (newSelection && window.document.activeElement === elem) {
        elem.selectionStart = newSelection[0];
        elem.selectionEnd = newSelection[1];
      }
    }
  };

  //replaceText(ctx.get());


  // *** remote -> local changes

  ctx.onRemove(function(pos, length) {
    var transformCursor = function(cursor) {
      // If the cursor is inside the deleted region, we only want to move back to the start
      // of the region. Hence the Math.min.
      return pos < cursor ? cursor - Math.min(length, cursor - pos) : cursor;
    };
    var transformCursorCM = function(text, cursor) {
      var newCursor = cursor;
      var textLines = text.substr(0, pos).split("\n");
      var removedTextLineNumber = textLines.length-1;
      var removedTextColumnIndex = textLines[textLines.length-1].length;
      var removedLines = text.substr(pos, length).split("\n").length - 1;
      if(cursor.line > (removedTextLineNumber + removedLines)) {
        newCursor.line -= removedLines;
      }
      else if(removedLines > 0 && cursor.line === (removedTextLineNumber+removedLines)) {
        var lastLineCharsRemoved = text.substr(pos, length).split("\n")[removedLines].length;
        if(cursor.ch >= lastLineCharsRemoved) {
          newCursor.line = removedTextLineNumber;
          newCursor.ch = removedTextColumnIndex + cursor.ch - lastLineCharsRemoved;
        }
        else {
          newCursor.line -= removedLines;
          newCursor.ch = removedTextColumnIndex;
        }
      }
      else if(cursor.line === removedTextLineNumber && cursor.ch > removedTextLineNumber) {
        newCursor.ch -= Math.min(length, cursor.ch-removedTextLineNumber);
      }
      return newCursor;
    };
    replaceText(ctx.getUserDoc(), transformCursor, transformCursorCM);
  });

  ctx.onInsert(function(pos, text) {
    var transformCursor = function(cursor) {
      return pos < cursor ? cursor + text.length : cursor;
    };
    var transformCursorCM = function(oldtext, cursor) {
      var newCursor = cursor;
      var textLines = oldtext.substr(0, pos).split("\n");
      var addedTextLineNumber = textLines.length-1;
      var addedTextColumnIndex = textLines[textLines.length-1].length;
      var addedLines = text.split("\n").length - 1;
      if(cursor.line > addedTextLineNumber) {
        newCursor.line += addedLines;
      }
      else if(cursor.line === addedTextLineNumber && cursor.ch > addedTextColumnIndex) {
        newCursor.line += addedLines;
        if(addedLines > 0) {
          newCursor.ch = newCursor.ch - addedTextColumnIndex + text.split("\n")[addedLines].length;
        }
        else {
          newCursor.ch += text.split("\n")[addedLines].length;
        }
      }
      return newCursor;
    };
    replaceText(ctx.getUserDoc(), transformCursor, transformCursorCM);
  });


  // *** local -> remote changes

  // This function generates operations from the changed content in the textarea.
  var genOp = function() {
    // In a timeout so the browser has time to propogate the event's changes to the DOM.
    setTimeout(function() {
      var val = elem.value;
      if (val !== content) {
        applyChange(ctx, ctx.getUserDoc(), cannonicalize(val));
      }
    }, 0);
  };

  var eventNames = ['textInput', 'keydown', 'keyup', 'select', 'cut', 'paste'];
  for (var i = 0; i < eventNames.length; i++) {
    var e = eventNames[i];
    if (elem.addEventListener) {
      elem.addEventListener(e, genOp, false);
    } else {
      elem.attachEvent('on' + e, genOp);
    }
  }
  window.setTimeout(function() {
    if(cmElem) {
      var elem2 =  cmElem;
      elem2.on('change', function() {
        elem2.save();
        genOp();
      });
    }
    else {
    console.log('CM inexistant');
    }
  }, 500);


  ctx.detach = function() {
    for (var i = 0; i < eventNames.length; i++) {
      var e = eventNames[i];
      if (elem.removeEventListener) {
        elem.removeEventListener(e, genOp, false);
      } else {
        elem.detachEvent('on' + e, genOp);
      }
    }
  };

  return ctx;
};

return { attach: attachTextarea };
});
