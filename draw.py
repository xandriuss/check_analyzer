import cv2

img = cv2.imread("assets/test.png", cv2.IMREAD_COLOR)
print(img.size)
#border
img = cv2.copyMakeBorder(img, 10, 10, 10, 10, cv2.BORDER_CONSTANT, value=(0, 255, 0))

# line
cv2.line(img, (90, 90), (90, 222), (255, 0, 0), 5)

#arrow
cv2.arrowedLine(img, (50, 200), (200, 50), (0, 0, 255), 5)

#cicrle
cv2.circle(img, (150, 150), 50, (255, 255, 0), 5)

#exclipse
cv2.ellipse(img, (150, 150), (100, 50), 0, 0, 360, (255, 0, 255), 5)

#rectangle
cv2.rectangle(img, (100, 100), (200, 200), (0, 255, 255), 5)

#text
cv2.putText(img, "Hello", (50, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 2)




cv2.imshow("test", img)
cv2.waitKey(0)  
cv2.destroyAllWindows()